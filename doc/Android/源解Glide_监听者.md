---
title: 源解 Glide 之监听者
description: 通过阅读 Glide 源码，了解如何监听生命周期、内存变化、网络变化
head:
  - - meta
    - name: description
      content: 通过阅读 Glide 源码，了解如何监听生命周期、内存变化、网络变化
  - - meta
    - name: keywords
      content: Android、源码、Glide
---
# 源解 Glide - 监听者
---
# 如何监听生命周期
生命周期的监听是在 `Glide.with()`  内部调用 `RequestManagerRetriever#get()` 部分实现。<br>
主要实现逻辑：添加一个 Fragment，用其监听生命周期，然后通过观察者模式将当前状态下发。具体响应是在 RequestManager 中，其在默认构造方法中将自己注册为监听者。其同时持有 target 和 request，当生命周期变化时，由 RequestManager 分别处理 target 和 request 逻辑。<br>
通过判断传入的入参类型分别处理：
- is FragmentActivity，通过 supportFragmentManager 添加一个 Fragment 实现监听生命周期
- is Activity，通过 fragmentManager  添加一个 Fragment 实现监听生命周期
- is Fragment，通过 childFragmentManager 添加一个 Fragment 实现监听生命周期
- is Context，通过判断 context 类型，分别进行处理。如果是 ApplicationContext，则直接监听 App 生命周期（ApplicationLifecycle）
- is View，通过 view.getContext 获取 context，再根据其类型分别处理（与上面逻辑一样）

下面分别看下具体实现源码
## 不同入参分别添加监听 Fragment
### is FragmentActivity
内部实现逻辑很简洁：
- 非主线程，则直接监听 App 生命周期
- 通过 `FragmentActivity#getSupportFragmentManager()` 获取 FragmentManager
- 通过 `findFragmentByTag()` 判断是否已经添加了监听生命周期的 Fragment
- 没有添加，则直接创建 Framgnet (`new SupportRequestManagerFragment()`) 并添加到 FragmentManager。
- 监听生命周期的 Fragment 准备好后，获取其持有的 RequestManager。如果没有，则创建 RequestManager 并 set 给Fragment。RequestManager 创建时会将自己注册到 Fragment 的生命周期维护者（ActivityFragmentLifecycle）中，之后生命周期变化由 RequestManager 响应。

代码中有一个逻辑操作值得学习。<br>
由于添加操作是异步的(`commitAllowingStateLoss`)，那么就有可能存在并发问题（重复创建、添加）。如何解决？
> 由于 `commitAllowingStateLoss` 是异步的，类似 Handler.post()，所以可通过自己维护一个添加队列 + handler消息来避免重复添加。具体实现可看源码 `RequestManagerRetriever#getSupportRequestManagerFragment()`部分，简单实现逻辑如下：
> - 自己维护一个 HashMap，key = fragmentManager，value = Fragment，用于维护异步创建中的 Fragment。
> - 当创建时判断 hashMap 中是否已存在，如果有则直接返回。
> - 没有则创建并添加，同时添加到 hashMap，并创建一条 handler 消息，当接受到消息时说明 fragment 添加完成，从 hashMap 中移除。

::: details is FragmentActivity 源码
```java
public class RequestManagerRetriever implements Handler.Callback{ 

  public RequestManager get(@NonNull FragmentActivity activity) {
    //非主线程，则直接使用 ApplicaitonContext，即监听 App 生命周期
    if (Util.isOnBackgroundThread()) {
      return get(activity.getApplicationContext());
    }
    //获取 SupportFragmentManager，然后调用 supportFragmentGet() 注册/复用用于监听生命周期的 Fragment
    else {
      assertNotDestroyed(activity);
      FragmentManager fm = activity.getSupportFragmentManager();
      return supportFragmentGet(activity, fm, /*parentHint=*/ null, isActivityVisible(activity));
    }
  }

  private RequestManager supportFragmentGet(Context context, FragmentManager fm, Fragment parentHint,  boolean isParentVisible) {
    //获取/添加生命周期监听的 Fragment
    SupportRequestManagerFragment current = getSupportRequestManagerFragment(fm, parentHint, isParentVisible);
    //获取/创建 RequestManager
    RequestManager requestManager = current.getRequestManager();
    if (requestManager == null) {
      Glide glide = Glide.get(context);
      //创建 RequestManager, 通过传入的 getGlideLifecycle()，将自己注册为监听者
      requestManager = factory.build(glide, current.getGlideLifecycle(), current.getRequestManagerTreeNode(), context);
      //将 Fragment 与 RequestManager 建立绑定
      current.setRequestManager(requestManager);
    }
    return requestManager;
  }

  private SupportRequestManagerFragment getSupportRequestManagerFragment(final FragmentManager fm, Fragment parentHint, boolean isParentVisible) {
    //从 framgnetManager 中获取监听生命周期的 Fragment
    SupportRequestManagerFragment current = (SupportRequestManagerFragment) fm.findFragmentByTag(FRAGMENT_TAG);
    //如果没有，则创建并注册
    if (current == null) {
      //判断是否有正在等待注册的Fragment。因为 add 是一个异步操作，此判断可防止重复创建
      current = pendingSupportRequestManagerFragments.get(fm);
      if (current == null) {
        //创建用于监听生命周期的 Fragment (SupportRequestManagerFragment)
        current = new SupportRequestManagerFragment();
        current.setParentFragmentHint(parentHint);
        //如果监听的 activity 没有 finish，则直接前进生命周期
        if (isParentVisible) {
          current.getGlideLifecycle().onStart();
        }
        pendingSupportRequestManagerFragments.put(fm, current);
        fm.beginTransaction().add(current, FRAGMENT_TAG).commitAllowingStateLoss();
        //因为 commitAllowingStateLoss 不是立即生效，所以发送一条 handler 消息，结合 pendingSupportRequestManagerFragments 防止重复创建
        handler.obtainMessage(ID_REMOVE_SUPPORT_FRAGMENT_MANAGER, fm).sendToTarget();
      }
    }
    return current;
  }
}
```
:::
### is Activity
内部逻辑与 is FragmentActivity 几乎一直，区别仅获取 FragmentManager 的获取方式不同。
::: details is Activity 源码
```java
public class RequestManagerRetriever implements Handler.Callback{ 

    public RequestManager get(Activity activity) {
      //非主线程，则直接使用 ApplicaitonContext，即监听 App 生命周期
      if (Util.isOnBackgroundThread()) {
        return get(activity.getApplicationContext());
      } 
      //获取 FragmentManager，然后调用 fragmentGet() 注册/复用用于监听生命周期的 Fragment
      else {
        assertNotDestroyed(activity);
        android.app.FragmentManager fm = activity.getFragmentManager();
        return fragmentGet(activity, fm, /*parentHint=*/ null, isActivityVisible(activity));
      }
    }

    private RequestManager fragmentGet(Context context, android.app.FragmentManager fm, android.app.Fragment parentHint, boolean isParentVisible) {
      //获取/添加生命周期监听的 Fragment
      RequestManagerFragment current = getRequestManagerFragment(fm, parentHint, isParentVisible);
      //获取/创建 RequestManager
      RequestManager requestManager = current.getRequestManager();
      if (requestManager == null) {
        Glide glide = Glide.get(context);
        requestManager = factory.build(glide, current.getGlideLifecycle(), current.getRequestManagerTreeNode(), context);
        current.setRequestManager(requestManager);
      }
      return requestManager;
    }

    private RequestManagerFragment getRequestManagerFragment(final android.app.FragmentManager fm, android.app.Fragment parentHint, boolean isParentVisible) {
      //从 framgnetManager 中获取监听生命周期的 Fragment
      RequestManagerFragment current = (RequestManagerFragment) fm.findFragmentByTag(FRAGMENT_TAG);
      //如果没有，则创建并注册
      if (current == null) {
        //判断是否有正在等待注册的Fragment。因为 add 是一个异步操作，此判断可防止重复创建
        current = pendingRequestManagerFragments.get(fm);
        if (current == null) {
          //创建用于监听生命周期的 Fragment (SupportRequestManagerFragment)
          current = new RequestManagerFragment();
          current.setParentFragmentHint(parentHint);
          if (isParentVisible) {
            //如果监听的 activity 没有 finish，则直接前进生命周期
            current.getGlideLifecycle().onStart();
          }
          pendingRequestManagerFragments.put(fm, current);
          fm.beginTransaction().add(current, FRAGMENT_TAG).commitAllowingStateLoss();
          //因为 commitAllowingStateLoss 不是立即生效，所以发送一条 handler 消息，结合 pendingSupportRequestManagerFragments 防止重复创建
          handler.obtainMessage(ID_REMOVE_FRAGMENT_MANAGER, fm).sendToTarget();
        }
      }
      return current;
    }
}
```
:::
### is Fragment
内部逻辑与 is FragmentActivity 几乎一直，区别有两处：1. 获取 FragmentManager 的获取方式不同。2. 监听对象不同，虽然都调用的 `supportFragmentGet()`。但此处传入了 fragment，即监听当前 fragment 的生命周期。
::: details is Fragment 源码
```java
public class RequestManagerRetriever implements Handler.Callback{ 
  
  public RequestManager get(@NonNull Fragment fragment) {
    //非主线程，则直接使用 ApplicaitonContext，即监听 App 生命周期
    if (Util.isOnBackgroundThread()) {
      return get(fragment.getContext().getApplicationContext());
    } 
    //获取 ChildFragmentManager，然后调用 supportFragmentGet() 注册/复用用于监听生命周期的 Fragment
    else {
      FragmentManager fm = fragment.getChildFragmentManager();
      //注意：这里第三个参数传入了 fragment!!!
      return supportFragmentGet(fragment.getContext(), fm, fragment, fragment.isVisible());
    }
  }
}
```
:::
### is Context
内部逻辑：
- 非主线程，则直接监听 App 生命周期
- 根据 context 类型分别处理
  - context is FragmentActivity，复用上面 is FragmentActivity 逻辑
  - context is Activity，复用上面 is Activity 逻辑
  - context is ContextWrapper，则往上寻找(getBaseContext)，最顶层就是 ApplicationContext
  - context is ApplicationContext，则监听 App 生命周期（`new ApplicationLifecycle()`）
::: details is Context 源码
```java
public class RequestManagerRetriever implements Handler.Callback{ 

    public RequestManager get(@NonNull Context context) {
        // context !is Applciation : 创建一个 Frament 监听生命周期并持有 RequestManager 对象，方法返回 RequestManager 对象
        // 复用上面逻辑。
        if (Util.isOnMainThread() && !(context instanceof Application)) {
            if (context instanceof FragmentActivity) {
                return get((FragmentActivity)context);
            }

            if (context instanceof Activity) {
                return get((Activity)context);
            }

            if (context instanceof ContextWrapper && ((ContextWrapper)context).getBaseContext().getApplicationContext() != null) {
                return get(((ContextWrapper)context).getBaseContext());
            }
        }
        //context is Application : 直接调用 fractroy.build() 创建 RequestManager 对象，并监听 App 生命周期
        return getApplicationManager(context);
    }

    private RequestManager getApplicationManager(@NonNull Context context) {
      if (applicationManager == null) {
        synchronized (this) {
          if (applicationManager == null) {
            Glide glide = Glide.get(context.getApplicationContext());
            // 此处监听 App 生命周期，ApplicationLifecycle
            applicationManager = factory.build(glide, new ApplicationLifecycle(), new EmptyRequestManagerTreeNode(), context.getApplicationContext());
          }
        }
      }

      return applicationManager;
    }
}
```
:::
### is View
内部逻辑：
- 非主线程，则直接监听 App 生命周期
- 获取 `view.getContext()`，然后向上寻找(`getBaseContext()`)类型为 Activity 的 Context，如果没有则直接使用 ApplicationContext，即监听 App 生命周期。
- 如果有，则判断是否为 FragmentActivity，如果是则获取所有 fragment，遍历获取 fragment.getView == view 的 Fragment，找到则复用 is Fragment 的逻辑，没有找到则复用 is FragmentActivity 逻辑。
- 如果不是 FragmentActivity，则按照 Activity 来处理，遍历获取 fragment.getView == view 的 Fragment，找到则复用 is Fragment 的逻辑，没有找到则复用 is Activity 逻辑。
::: details is View 源码
```java
public class RequestManagerRetriever implements Handler.Callback{ 

    public RequestManager get(@NonNull View view) {
      //非主线程，则直接使用 ApplicaitonContext，即监听 App 生命周期
      if (Util.isOnBackgroundThread()) {
        return get(view.getContext().getApplicationContext());
      }

      //往上寻找 Activity 类型的上下文（getBaseContext() is Activity)
      Activity activity = findActivity(view.getContext());
      if (activity == null) {
        //如果没有，则直接使用 ApplicaitonContext，即监听 App 生命周期
        return get(view.getContext().getApplicationContext());
      }

      // activity is FragmentActivity 
      if (activity instanceof FragmentActivity) {
        //获取当前 supportFragmentManager 中所有 Fragment，获取 fragment.getView == view 的 fragment
        Fragment fragment = findSupportFragment(view, (FragmentActivity) activity);
        // 如果有，则复用 is Fragment 的逻辑；如果没有，则则复用 is FragmentActivity 的逻辑
        return fragment != null ? get(fragment) : get((FragmentActivity) activity);
      }

      // 获取当前 fragmentManager 中所有 Fragment，获取 fragment.getView == view 的 fragment
      android.app.Fragment fragment = findFragment(view, activity);
      //如果没有，则复用 is Activity 逻辑；如果有，则复用 is Fragment 的逻辑
      if (fragment == null) {
        return get(activity);
      }
      return get(fragment);
  }
}
```
:::
## 监听 Fragment 的实现
内部逻辑：
- 在默认构造函数中创建生命周期管理者（ActivityFragmentLifecycle），后续生命周期回调都调用该管理者对应方法。
- RequestManager 在创建时，默认构造方法中将自己注册为监听者（`ActivityFragmentLifecycle#addListener()`），后续生命周期响应交由 RequestManager 负责。
```java
public class SupportRequestManagerFragment extends Fragment {

    public SupportRequestManagerFragment() {
      //默认由 ActivityFragmentLifecycle 来负责管理生命周期分发
      this(new ActivityFragmentLifecycle());
    }

    public SupportRequestManagerFragment(@NonNull ActivityFragmentLifecycle lifecycle) {
      this.lifecycle = lifecycle;
    }

    @Override
    public void onStart() {
      super.onStart();
      lifecycle.onStart();
    }

    @Override
    public void onStop() {
      super.onStop();
      lifecycle.onStop();
    }

    @Override
    public void onDestroy() {
      super.onDestroy();
      lifecycle.onDestroy();
      unregisterFragmentWithRoot();
    }
}
```
::: details ActivityFragmentLifecycle源码
```java
class ActivityFragmentLifecycle implements Lifecycle {

  private final Set<LifecycleListener> lifecycleListeners =Collections.newSetFromMap(new WeakHashMap<LifecycleListener, Boolean>());
  private boolean isStarted;
  private boolean isDestroyed;

  @Override
  public void addListener(@NonNull LifecycleListener listener) {
    lifecycleListeners.add(listener);

    if (isDestroyed) {
      listener.onDestroy();
    } else if (isStarted) {
      listener.onStart();
    } else {
      listener.onStop();
    }
  }

  @Override
  public void removeListener(@NonNull LifecycleListener listener) {
    lifecycleListeners.remove(listener);
  }

  void onStart() {
    isStarted = true;
    for (LifecycleListener lifecycleListener : Util.getSnapshot(lifecycleListeners)) {
      lifecycleListener.onStart();
    }
  }

  void onStop() {
    isStarted = false;
    for (LifecycleListener lifecycleListener : Util.getSnapshot(lifecycleListeners)) {
      lifecycleListener.onStop();
    }
  }

  void onDestroy() {
    isDestroyed = true;
    for (LifecycleListener lifecycleListener : Util.getSnapshot(lifecycleListeners)) {
      lifecycleListener.onDestroy();
    }
  }
}
```
:::
# 如何监听内存变化
内存监听也是在 Glide.with() 阶段。其实现是调用 `registerComponentCallbacks()` 将自己作为监听者，重写 `onTrimMemory()` 和 `onLowMemory()` 分别响应不同内存变化。
具体逻辑如下：
- 当内存紧张时，即 `onLowMemory()` 回调时，清空 memoryCache、bitmapPool、arrayPool；
- 当内存变化时，即 `onTrimMemory()` 回调时，根据等级分别进行处理。
  - 当 level >= `TRIM_MEMORY_BACKGROUND`(40) : 清空 memoryCache、bitmapPool、arrayPool；如果设置了 pauseAllOnTrim = true & level == `TRIM_MEMORY_MODERATE`(60)，则暂停所有请求（默认为 false 即不暂停）；
  - 当 level >= `TRIM_MEMORY_UI_HIDDEN`(20) || level == `TRIM_MEMORY_RUNNING_CRITICAL`(15) : memoryCache、bitmapPool、arrayPool 容量 / 2；如果 os >= 6.0 && level >= `TRIM_MEMORY_UI_HIDDEN`(20)，直接清空 bitmapPool；
```java
public class Glide implements ComponentCallbacks2 {

  //调用 getRetriever()内部逻辑:
  //  Glide.get(context) 如果没有初始化过 Glide，则最终会调用 initializeGlide() 创建 Glide 对象并返回该对象，如果初始化过则直接返回 Glide 对象
  private static RequestManagerRetriever getRetriever(@Nullable Context context) {
      return Glide.get(context).getRequestManagerRetriever();
  }

  private static void initializeGlide(@NonNull Context context, @NonNull GlideBuilder builder, @Nullable GeneratedAppGlideModule annotationGeneratedModule) {
      Context applicationContext = context.getApplicationContext();

      // 调用到 GlideBuilder.build() 方法，配置一些基础配置，如缓存大小、线程池等。
      Glide glide = builder.build(applicationContext);

      //...
      
      //注册监听内存变化
      applicationContext.registerComponentCallbacks(glide);
      Glide.glide = glide;
  }


  // 响应系统内存管理
  @Override
  public void onTrimMemory(int level) {
      this.trimMemory(level);
  }

  public void trimMemory(int level) {
      Util.assertMainThread();
      Iterator var2 = this.managers.iterator();

      //调用 RequestManager#onTrimMemory()
      while(var2.hasNext()) {
          RequestManager manager = (RequestManager)var2.next();
          // level == 60 && pauseAllOnTrim ? pauseAllRequests : ignore
          manager.onTrimMemory(level);
      }

      // level >=40 ? clear : (level >= 20 || level == 15 ? maxSize/2L : ignore)
      this.memoryCache.trimMemory(level);
      // level >= 40 || os >= 6.0 && level >= 20 ? clear : (level >=20 || level == 15 ? maxSize/2L : ignore)
      this.bitmapPool.trimMemory(level);
      // level >=40 ? clear : (level >= 20 || level == 15 ? maxSize/2L : ignore)
      this.arrayPool.trimMemory(level);
  }

  // 响应系统内存紧张
  @Override
  public void onLowMemory() {
      this.clearMemory();
  }

  public void clearMemory() {
      Util.assertMainThread();
      this.memoryCache.clearMemory();
      this.bitmapPool.clearMemory();
      this.arrayPool.clearMemory();
  }
}
```
# 如何监听网络状态变动
网络监听也是在 Glide.with() 阶段，具体是在 RequestManager 创建时，在构造函数中添加监听。
内部逻辑：
- 创建默认网络监听 DefaultConnectivityMonitor，其同时也是生命周期的监听者。当生命周期在 onStart 时，监听网络变化， onStop 时反注册监听。具体网络监听方式是通过广播来实现的，主要判断网络是否可用(`networkInfo.isConnected()`)
- 在创建网络监听时注入网络变化监听者（RequestManagerConnectivityListener），其持有 requestTracker 对象，并重写 `onConnectivityChanged(isConnected)`。当网络可用时(isConnected = true)，则调用 `requestTracker#restartRequests()` 重新发起请求。
```java
public class RequestManager implements ComponentCallbacks2, LifecycleListener, ModelTypes<RequestBuilder<Drawable>> {

  private final ConnectivityMonitor connectivityMonitor;

  RequestManager(Glide glide, Lifecycle lifecycle, RequestManagerTreeNode treeNode, RequestTracker requestTracker, ConnectivityMonitorFactory factory, Context context) {
    
     //监听网络状态变化
    this.connectivityMonitor = factory.build(context.getApplicationContext(), new RequestManagerConnectivityListener(requestTracker));
    //...
    lifecycle.addListener(this.connectivityMonitor);
    //...
  }
}
```
### 创建默认网络监听
factory 是在 Glide 创建是传入的，默认是 DefaultConnectivityMonitorFactory， 其内部根据权限判断，如果有网络权限，则创建默认生命周期监听 DefaultConnectivityMonitor，具体网络监听实现由它来实现。
```java
public class DefaultConnectivityMonitorFactory implements ConnectivityMonitorFactory {

  private static final String NETWORK_PERMISSION = "android.permission.ACCESS_NETWORK_STATE";

  @Override
  public ConnectivityMonitor build(@NonNull Context context, @NonNull ConnectivityMonitor.ConnectivityListener listener) {
    //判断网络权限
    int permissionResult = ContextCompat.checkSelfPermission(context, NETWORK_PERMISSION);
    boolean hasPermission = permissionResult == PackageManager.PERMISSION_GRANTED;
    //网络权限可以用，则创建网络监听 DefaultConnectivityMonitor，其持有 Listener
    return hasPermission ? new DefaultConnectivityMonitor(context, listener) : new NullConnectivityMonitor();
  }
}
```
::: details DefaultConnectivityMonitor 源码
```java
final class DefaultConnectivityMonitor implements ConnectivityMonitor {
  private static final String TAG = "ConnectivityMonitor";
  private final Context context;

  @Synthetic
  final ConnectivityListener listener;

  @Synthetic
  boolean isConnected;

  private boolean isRegistered;

  private final BroadcastReceiver connectivityReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(@NonNull Context context, Intent intent) {
          //网络发生变化时，再次调用 isConnected() 判断网络是否可用
          boolean wasConnected = isConnected;
          isConnected = isConnected(context);
          if (wasConnected != isConnected) {
            listener.onConnectivityChanged(isConnected);
          }
        }
      };

  DefaultConnectivityMonitor(@NonNull Context context, @NonNull ConnectivityListener listener) {
    this.context = context.getApplicationContext();
    this.listener = listener;
  }

  private void register() {
    if (isRegistered) {
      return;
    }
    isConnected = isConnected(context);
    try {
      //注册网络变化广播
      context.registerReceiver(connectivityReceiver, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
      isRegistered = true;
    } catch (SecurityException e) {}
  }

  private void unregister() {
    if (!isRegistered) {
      return;
    }
    context.unregisterReceiver(connectivityReceiver);
    isRegistered = false;
  }

  //判断当前网络是否可用
  @Synthetic
  boolean isConnected(@NonNull Context context) {
    ConnectivityManager connectivityManager = Preconditions.checkNotNull((ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE));
    NetworkInfo networkInfo;
    try {
      networkInfo = connectivityManager.getActiveNetworkInfo();
    } catch (RuntimeException e) {
      return true;
    }
    return networkInfo != null && networkInfo.isConnected();
  }

  //生命周期监听，当 onStart 时，监听网络状态
  @Override
  public void onStart() {
    register();
  }

  //生命周期监听，当 onStop 时，反注册监听
  @Override
  public void onStop() {
    unregister();
  }
}
```
:::
## 网络监听者
网络监听者(RequestManagerConnectivityListener) 是 RequestManager 的内部类，其持有 RequestTracker 对象，当网络可用时，调用其 `restartRequests()` 重新发起请求。
```java
public class RequestManager implements ComponentCallbacks2, LifecycleListener, ModelTypes<RequestBuilder<Drawable>> {

  private class RequestManagerConnectivityListener implements ConnectivityMonitor.ConnectivityListener {
    private final RequestTracker requestTracker;

    RequestManagerConnectivityListener(@NonNull RequestTracker requestTracker) {
      this.requestTracker = requestTracker;
    }

    @Override
    public void onConnectivityChanged(boolean isConnected) {
      //网络可用时，调用 restartRequests() 重新发起请求
      if (isConnected) {
        synchronized (RequestManager.this) {
          requestTracker.restartRequests();
        }
      }
    }
  }
}
```
---
# 资料
- [Glide v4: 资源重用](https://muyangmin.github.io/glide-docs-cn/doc/resourcereuse.html)
- [Android 开源库 #6 适可而止！看 Glide 如何把生命周期安排得明明白白 - 掘金](https://juejin.cn/post/6900548494818279432)
- [【带着问题学】Glide做了哪些优化? - 掘金](https://juejin.cn/post/6970683481127043085)
- [Android 图片加载框架 Glide 4.9.0 (二) 从源码的角度分析 Glide 缓存策略 - 掘金](https://juejin.cn/post/6844903953604280328)
- [聊一聊关于Glide在面试中的那些事 - 掘金](https://juejin.cn/post/6844904002551808013)