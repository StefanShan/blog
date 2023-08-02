---
title:  Jetpack 组件之 Lifecycle 使用与浅析
date: 2021/6/5 19:35:00
categories:
- Jetpack
tags:
- Jetpack
- Lifecycle
---

# Lifecycle 是什么？

**官方解释：**

> Lifecycle is a class that holds the information about the lifecycle state of a component (like an activity or a fragment) and allows other objects to observe this state.

**个人理解：**
Lifecycle 就是管理组件( Activity / Fragment )生命周期的一个工具(类），可以在其他组件( Activity / Fragment 之外)监听生命周期变化。该组件是 Jetpack 架构组件库(Jetpack Architecture Components)中非常重要的一部分，例如 LiveData、ViewModel 等组件，必须依赖该组件实现监听和处理生命周期变化。

<!-- more -->

# 怎么使用 Lifecycle？

## DefaultLifecycleObserver方式：[推荐]

> **前提**
> 
> - 项目使用Java 8 进行编译
> - 添加 gradle 依赖 "androidx.lifecycle:lifecycle-common-java8:$lifecycle_version"

```kotlin
class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        //注册生命周期监听
        lifecycle.addObserver(ActivityLifecycleObserver())
    }
}

/**
* 生命周期的监听类
* 可实现生命周期相关逻辑，使 LoginActivity 中的代码逻辑更加简洁
*/
class ActivityLifecycleObserver: DefaultLifecycleObserver{

    override fun onResume(owner: LifecycleOwner) {
        super.onResume(owner)
        //生命周期执行到了 onResume
    }
}
```

## 注解方式：

不推荐。注解方式是通过反射调用，存在性能损耗。
class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        //注册生命周期监听
        lifecycle.addObserver(ActivityLifecycleObserver())
    }
}

```kotlin
/**
* 生命周期的监听类
* 可实现生命周期相关逻辑，使 LoginActivity 中的代码逻辑更加简洁
*/
class ActivityLifecycleObserver: LifecycleObserver{

    @OnLifecycleEvent(Lifecycle.Event.ON_RESUME)
    fun onResume(){
        //生命周期执行到了 onResume
    }
}
```

## 拓展，自主管理生命周期

非常不推荐。这种自行维护生命周期，可能会出现竞态情况。

```kotlin
class LoginActivity : AppCompatActivity() {

    private lateinit var mLifecycleRegistry: LifecycleRegistry

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        //这里自定义LifecycleRegistry
        mLifecycleRegistry = LifecycleRegistry(this)
        mLifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)

        //注册生命周期监听
        lifecycle.addObserver(ActivityLifecycleObserver())
    }

    override fun onStart() {
        super.onStart()
        //通过自定义的 LifecycleRegistry 发送生命周期，可覆盖默认实现
        mLifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
    }

    // 必须要重写该方法，赋予自定义的Registry
    override fun getLifecycle(): Lifecycle {
        return mLifecycleRegistry
    }
}

class ActivityLifecycleObserver: LifecycleObserver{

    @OnLifecycleEvent(Lifecycle.Event.ON_RESUME)
    fun onResume(){
        //生命周期执行到了 onResume
    }
}
```

# Lifecycle 的原理是什么？

## 理解 Event、State

在开始源码讲解前，首先要明白 Event 与 State 之间的关系。这个至关重要，因为在源码中经常会有 Event 与 State 间的互相转换，需要依赖两者的关系图()促进理解才行。
<br/>**Event：** Lifecycle 发送对应的生命周期事件的枚举类，包含 onCreate、onStart 等生命周期事件。
<br/>**State：** Lifecycle 处理的生命周期状态，与Event是映射关系。
![loading-ag-4935](images/lifecycle/1.webp)

## 实现原理

> 原理仅讲解 Activity 部分，Fragment 的实现逻辑，可自行查看下 FragmentActivity # HostCallbacks 类的相关调用与逻辑。<br/>
> 源码部分基于 lifecycle 2.2.0 版本 与 acitivity 1.1.0 版本。

源码分析分为两部分，先从调用方法出发，大体知道内部逻辑，再从疑问入手，解答心里疑惑。

### 从调用方法出发

```kotlin
/**
* 这里有三部分组成: lifecycle、addObserver()、ActivityLifecycleObserver对象
* lifecycle: 对应的 getLifecycle() 方法,获取 Lifecycle 对象
* addObserver(): 调用 Lifecycle 对象的 addObserver() 方法
* ActivityLifecycleObserver对象: 这个是我们实现 DefaultLifecycleObserver 接口的类对象
*/
lifecycle.addObserver(ActivityLifecycleObserver())
```

通过调用方法可以发现，需要看一下 getLifecycle() 和 addObserver() 两个方法的内部逻辑是什么？<br/>
**getLifecycle() 内部实现：** <br/>
通过下面代码可以看到，getLifecycle() 方法真正实现是在 ComponentActivity中，并且创建一个 LifecycleRegistry 对象，通过该方法返回。

```kotlin
public class ComponentActivity extends androidx.core.app.ComponentActivity implements LifecycleOwner{
    // ... 省略 ...

    // 直接 new 了一个 LifecycleRegistry 对象。
    // LifecycleRegistry 这个类又是做什么的呢？ 这个我们后面在看。
    private final LifecycleRegistry mLifecycleRegistry = new LifecycleRegistry(this);

    // ... 省略 ...

    @NonNull
    @Override
    public Lifecycle getLifecycle() {
        return mLifecycleRegistry;
    }

    // ... 省略 ...

}
```

**addObserver() 内部实现：** <br/>
通过代码可以发现 LifecycleRegistry 才是实际的生命周期的管理类，这也是为什么上面 getLifecycle() 返回的是LifecycleRegistry 对象。代码看起来不少，但也是最核心的部分，简单总结下：

1. 调用 addObserver() 方法，内部会给定一个初始状态，并与 observer 绑定(通过 ObserverWithState)，然后调用了 sync() 方法。
2. sync() 方法内部根据状态之间的差异判断是往前走(forwardPass())还是往后走(backwardPass())。（此处咱们以往前走为例）
3. forwardPass()内部调用 upEvent() 方法，将 observer 的 State 转换为 Event，然后调用 ObserverWithState#dispatchEvent() 进行分发。
4. 此时我们自己实现的 Observer 类就会收到生命周期回调了。

PS: 这里需要注意 LifecycleRegistry#mState 和 ObserverWithState#mState 不要搞混了。

```kotlin
public class LifecycleRegistry extends Lifecycle {

    // ... 省略 ...

    @Override
    public void addObserver(@NonNull LifecycleObserver observer) {

        // 给定一个初始状态，创建 ObserverWithState 对象，将状态与 observer 传入，
        // 然后将 ObserverWithState 对象存入 map 中
        State initialState = mState == DESTROYED ? DESTROYED : INITIALIZED;
        ObserverWithState statefulObserver = new ObserverWithState(observer, initialState);
        ObserverWithState previous = mObserverMap.putIfAbsent(observer, statefulObserver);

        // ... 省略 ...

        if (!isReentrance) {
            // we do sync only on the top level.
            sync();
        }

        // ... 省略 ...
    }

    // ... 省略 ...

    private void sync() {
        LifecycleOwner lifecycleOwner = mLifecycleOwner.get();

        // ... 省略 ...

        // 通过 isSynced() 方法判断状态是否已经对齐。
        // 下面逻辑用于判断是往前走，还是往后走。
        // 需要借助“State 与 Event 关系图”来理解。
        // 例如:
        // 显示一个新建的Activity, mState = Created, mObserverMap.eldest().getValue().mState = INITIALIZED, 
        // newest.getValue().mState = INITIALIZED。通过以下逻辑可以判断，执行 forwardPass() 方法(往前走)
        while (!isSynced()) {
            if (mState.compareTo(mObserverMap.eldest().getValue().mState) < 0) {
                backwardPass(lifecycleOwner);
            }
            Entry<LifecycleObserver, ObserverWithState> newest = mObserverMap.newest();
            if (!mNewEventOccurred && newest != null
                    && mState.compareTo(newest.getValue().mState) > 0) {
                forwardPass(lifecycleOwner);
            }
        }
    }

    // ... 省略 ...

    private void forwardPass(LifecycleOwner lifecycleOwner) {
        Iterator<Entry<LifecycleObserver, ObserverWithState>> ascendingIterator =
                mObserverMap.iteratorWithAdditions();
        while (ascendingIterator.hasNext() && !mNewEventOccurred) {
            Entry<LifecycleObserver, ObserverWithState> entry = ascendingIterator.next();
            ObserverWithState observer = entry.getValue();
            while ((observer.mState.compareTo(mState) < 0 && !mNewEventOccurred
                    && mObserverMap.contains(entry.getKey()))) {
                pushParentState(observer.mState);

                // 重点在这里~ 调用 upEvent() 方法，获取当前 State 对应的 Event，
                // 然后调用 ObserverWithState 的 dispatchEvent() 方法分发
                observer.dispatchEvent(lifecycleOwner, upEvent(observer.mState));

                popParentState();
            }
        }
    }

    // ... 省略 ...

    // State 转 Event。可参照“State 与 Event 关系图”来理解
    private static Event upEvent(State state) {
        switch (state) {
            case INITIALIZED:
            case DESTROYED:
                return ON_CREATE;
            case CREATED:
                return ON_START;
            case STARTED:
                return ON_RESUME;
            case RESUMED:
                throw new IllegalArgumentException();
        }
        throw new IllegalArgumentException("Unexpected state value " + state);
    }

    // ... 省略 ...


    // 静态内部类，用于绑定 observer 与 State
    static class ObserverWithState {
        State mState;
        LifecycleEventObserver mLifecycleObserver;

        ObserverWithState(LifecycleObserver observer, State initialState) {

            // 这里将自己实现的 Observer 类对象做了一层转换。内部有对注解方式的实现，可自行查看。
            mLifecycleObserver = Lifecycling.lifecycleEventObserver(observer);

            mState = initialState;
        }


        // 通过 Event 转 State，对当前 Event 事件进行下发，并更新 observer 的 State
        void dispatchEvent(LifecycleOwner owner, Event event) {
            State newState = getStateAfter(event);
            mState = min(mState, newState);
            mLifecycleObserver.onStateChanged(owner, event);
            mState = newState;
        }
    }

    // ... 省略 ...
}
```

## 从疑问出发

**1. Lifecycle 是如何监听生命周期的？又怎么通知其他组件(Observer)生命周期变化的？**<br/>
从上面的“从调用方法入手”没有看到如何监听生命周期变化的，那么这一块逻辑在哪里呢？
(这里以 监听 Activity 生命周期为例) 在 ComponentActivity#onCreate() 方法中调用了 ReportFragment#injectIfNeededIn()。ReportFragment 就是真正的生命周期提供者(被观察者)，它内部提供生命周期的变化，并调用 LifecycleRegistry#handleLifecycleEvent() 方法进行下发。handleLifecycleEvent()  方法内部将 Event 转 State，然后调用 sync 方法，剩余逻辑就和“从调用方法触发”中的一样了(可以看 *addObserver()* 内部实现 部分)。

```kotlin
public class ComponentActivity extends androidx.core.app.ComponentActivity implements
        LifecycleOwner,
        ViewModelStoreOwner,
        SavedStateRegistryOwner,
        OnBackPressedDispatcherOwner {
    // ... 省略 ...

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mSavedStateRegistryController.performRestore(savedInstanceState);

        // 这里
        ReportFragment.injectIfNeededIn(this);
        if (mContentLayoutId != 0) {
            setContentView(mContentLayoutId);
        }
    }

}

//实际生命周期被观察者
public class ReportFragment extends Fragment {
    // ... 此处省略生命周期相关逻辑，最后都会调用 dispatch() ...

    private void dispatch(Lifecycle.Event event) {
        Activity activity = getActivity();

        // ... 省略 ...

        if (activity instanceof LifecycleOwner) {
            Lifecycle lifecycle = ((LifecycleOwner) activity).getLifecycle();
            if (lifecycle instanceof LifecycleRegistry) {

                    //调用 LifecycleRegistry#handleLifecycleEvent() 方法触发事件
                ((LifecycleRegistry) lifecycle).handleLifecycleEvent(event);
            }
        }
    }

}

public class LifecycleRegistry extends Lifecycle {
    // ... 省略 ...

    public void handleLifecycleEvent(@NonNull Lifecycle.Event event) {
        // 根据传入的 Event 获取 State
        State next = getStateAfter(event);
        moveToState(next);
    }

    // 更新 LifecycleRegistry#mState 值，然后调用 sync() 方法
    private void moveToState(State next) {
        // ... 省略 ...

        mState = next;

        // ... 省略 ...

        sync();
    }

    // ... 省略 ...

}
```

**2. addObserver() 在 onStart() 中调用的话，还会受到 onCreate 生命周期吗？** <br/>
通过如下代码和注释可以得出结论：如果不是在 onCreate() 中调用 addObserver()，仍然可以得到生命周期事件。

```kotlin
public class LifecycleRegistry extends Lifecycle {

    // ... 省略 ...

    @Override
    public void addObserver(@NonNull LifecycleObserver observer) {

        // ... 省略 ...

        // 这里开始比较 observer 的 State 与当前的 State，如果晚于当前的 State 则触发 dipatchEvent 追赶当前的生命周期。
        // 比较两个 State 的意义在于 addObserver() 调用如果不在 onCreate 中，则仍可以接收到 onCreate 生命周期。
        // 例如：
        // 当前的 State = Started, observer 的 State = INITIALIZED，
        // observer 的 State 晚于当前的 State，则触发 dispatchEvent(INITIALIZED)
        while ((statefulObserver.mState.compareTo(targetState) < 0
                && mObserverMap.contains(observer))) {
            pushParentState(statefulObserver.mState);
            statefulObserver.dispatchEvent(lifecycleOwner, upEvent(statefulObserver.mState));
            popParentState();
            // 为了防止在observer State 在追赶途中，当前 State 又发生了变化，则调用 calculateTargetState() 再次计算一下两者差距
            targetState = calculateTargetState(observer);
        }

        if (!isReentrance) {
            // we do sync only on the top level.
            sync();
        }

        // ... 省略 ...
    }

    // ... 省略 ...
}
```

**3. 项目现在继承的是 Activity 类，怎么使用 Lifecycle 呢？** <br/>
通过代码可以得知，Lifecycle 的生命周期变化是在 ComponentActivity，如果继承的是 Activity，那只能自己维护生命周期的变化，类似于“*拓展，自主管理生命周期*”，区别在于需要实现 LifecycleOwner 接口，并维护全生命周期。以下为示例代码：

```kotlin
open class BaseActivity : Activity(), LifecycleOwner{

    private val mLifecycleRegistry = LifecycleRegistry(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        mLifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
    }

    override fun onStart() {
        super.onStart()
        mLifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
    }

    override fun onDestroy() {
        super.onDestroy()
        mLifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
    }

    override fun getLifecycle(): Lifecycle {
        return mLifecycleRegistry
    }
}
```

## 总结

简单总结下Lifecycle的实现原理：在 ComponentActivity 调用 ReportFragment 来监听生命周期变化，当生命周期变化时，调用 LifecycleRegistry#handleLifecycleEvent() 来通知。然后调用 LifecycleRegistry#addObserver() 方法，内部会根据 State 与 Event 进行转换，并下发生命周期事件。
下面为调用时序图，可参照自行走一遍源码。
![loading-ag-4937](images/lifecycle/2.webp)
