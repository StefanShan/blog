---
title: Jetpack 组件之 ViewModel 使用与浅析
date: 2021/6/19 17:06:00
categories:
- Jetpack
tags:
- Jetpack
- ViewModel
---

# ViewModel 是什么？

**官方解释：**

> The ViewModel class is designed to store and manage UI-related data in a lifecycle conscious way. The ViewModel class allows data to survive configuration changes such as screen rotations.

**个人理解：** <br/>
ViewModel 是 UI 和数据的桥接层，承担 UI 层(Activity / Fragment) 的数据处理逻辑，同时拥有维护自己的生命周期，而且可以在屏幕旋转时仍保存数据。下面是官方提供的一张屏幕旋转时 ViewModel 的生命周期图。
![loading-ag-5085](images/viewModel/1.webp)

<!-- more -->

# 怎么使用 ViewModel？

这里以 Activity 中使用为例。

1. 自定义 ViewModel 类，继承自 ViewModel。该类将用作数据处理，并返回数据给UI
   
   ```kotlin
   // 这里仅是示例，推荐结合 LiveData 一起使用。
   class CustomViewModel: ViewMdoel(){
    private val data: List<String> = mutableListOf()
   
    fun getData(): List<String> {
        retrun data
    }
   }
   ```

2. 在 Activity 中获取自定义的 ViewModel 类，调用相应方法获取处理后的数据
   
   ```kotlin
   //这里以 Activity 示例，Fragment 类似。
   class MyActivity : AppCompatActivity() {
   
    override fun onCreate(savedInstanceState: Bundle?) {
   
        // 通过ktx 获取自定义 ViewModel 类
        // 需要添加依赖 implementation 'androidx.lifecycle:lifecycle-viewmodel-ktx:$viewmodel_version'
        //val viewModel: CustomViewModel by viewModels()
   
        // 通过“传统方式” 获取自定义 ViewModel 类
        val viewModel = ViewModelProvider(this).get(CustomViewModel::class.java)
   
        //获取数据，实现后续UI逻辑
        val data = viewModel.getData()
    }
   }
   ```
   
   # ViewModel 的原理是什么？
   
   **原理仅讲解 Activity 部分。
   源码部分基于 lifecycle 2.2.0 版本 与 acitivity 1.1.0 版本。**

源码分析分为两部分，先从调用方法出发，大体知道内部逻辑，再从疑问入手，解答心里疑惑。

## 实现原理

### 从调用方法出发

```kotlin
//通过 ViewModelProvider#get() 获取自定义 ViewModel 对象，然后就可以调用相关方法
ViewModelProvider(this).get(CustomViewModel::class.java)
```

通过调用方法可以发现，需要了解下 ViewModelProvider() 和 get() 方法的内部实现。 

**ViewModelProvider() 内部实现：**

```java
public class ViewModelProvider {

    private final Factory mFactory;
    private final ViewModelStore mViewModelStore;

    // ... 省略 ...

    // 入参为 ViewModelStoreOwner，通过 owner 获取 ViewModelStore 和 ViewModelFactory
    public ViewModelProvider(@NonNull ViewModelStoreOwner owner) {
        this(owner.getViewModelStore(), owner instanceof HasDefaultViewModelProviderFactory
            ? ((HasDefaultViewModelProviderFactory) owner).getDefaultViewModelProviderFactory()
            : NewInstanceFactory.getInstance());
    }

    /**
     * Creates {@code ViewModelProvider}, which will create {@code ViewModels} via the given
     * {@code Factory} and retain them in the given {@code store}.
     *
     * @param store   {@code ViewModelStore} where ViewModels will be stored.
     * @param factory factory a {@code Factory} which will be used to instantiate
     *                new {@code ViewModels}
     */
    public ViewModelProvider(@NonNull ViewModelStore store, @NonNull Factory factory) {
        mFactory = factory;
        mViewModelStore = store;
    }

    // ... 省略 ...
}
```

通过上面代码可以发现，ViewModelProvider 内部维护的 ViewModelStore 和 Factory 都是通过传入的 owner 创建的。根据调用传入的 this 可以知道，此时的owner 为 Activity，那么看下 Activity 中是怎么实现创建的。

```java
public class ComponentActivity extends androidx.core.app.ComponentActivity implements
        LifecycleOwner,
        ViewModelStoreOwner,
        HasDefaultViewModelProviderFactory {

     // ... 省略 ...

    @NonNull
    @Override
    public ViewModelStore getViewModelStore() {
        // ... 省略 ...

        if (mViewModelStore == null) {
            // 从上次配置发生更改(例如屏幕旋转)中获取
            NonConfigurationInstances nc =
                   (NonConfigurationInstances) getLastNonConfigurationInstance();
            if (nc != null) {
                mViewModelStore = nc.viewModelStore;
            }
            if (mViewModelStore == null) {
                // 直接创建
                // ViewModelStore 内部只有一个 Map 来存储创建的 ViewModel
                mViewModelStore = new ViewModelStore();
            }
        }
        return mViewModelStore;
    }

    // ... 省略 ...

    @NonNull
    @Override
    public ViewModelProvider.Factory getDefaultViewModelProviderFactory() {
        // ... 省略 ...

        // 这里判断是否有创建过，没有则直接创建。
        if (mDefaultFactory == null) {
            mDefaultFactory = new SavedStateViewModelFactory(
                    getApplication(),
                    this,
                    getIntent() != null ? getIntent().getExtras() : null);
        }
        return mDefaultFactory;
    }

    // ... 省略 ...
}
```

通过上面代码可以知道，ComponentActivity 实现 ViewModelStoreOwner 和 HasDefaultViewModelProviderFactory 接口，分别创建了 ViewModelStore 和 SavedStateViewModelFactory 对象。ViewModelStore 内部维护了一个Map，用于存储创建的 ViewModel。SavedStateViewModelFactory 内部是维护了 ViewModel 的创建，是一个工厂类。
Ok，ViewModelProvider 构造函数的内部逻辑到此为止。

**ViewModelProvider#get() 内部实现：**

```java
public class ViewModelProvider {

    private static final String DEFAULT_KEY =
                "androidx.lifecycle.ViewModelProvider.DefaultKey";

    private final Factory mFactory;
    private final ViewModelStore mViewModelStore;

    // ... 省略 ...

    @NonNull
    @MainThread
    public <T extends ViewModel> T get(@NonNull Class<T> modelClass) {
        String canonicalName = modelClass.getCanonicalName();
        if (canonicalName == null) {
            throw new IllegalArgumentException("Local and anonymous classes can not be ViewModels");
        }
        return get(DEFAULT_KEY + ":" + canonicalName, modelClass);
    }

    @NonNull
    @MainThread
    public <T extends ViewModel> T get(@NonNull String key, @NonNull Class<T> modelClass) {
        //从缓存中获取
        ViewModel viewModel = mViewModelStore.get(key);

        if (modelClass.isInstance(viewModel)) {
            if (mFactory instanceof OnRequeryFactory) {
                ((OnRequeryFactory) mFactory).onRequery(viewModel);
            }
            return (T) viewModel;
        } else {
            //noinspection StatementWithEmptyBody
            if (viewModel != null) {
                // TODO: log a warning.
            }
        }

        // 缓存没有，则进行创建。
        // 根据上面 "ViewModelProvider() 内部实现" 可以得知，mFactory = new SavedStateViewModelFactory(),
        // 而 SavedStateViewModelFactory 实现的 ViewModelProvider.KeyedFactory 接口。
        // 所以此时 (mFactory instanceof KeyedFactory) = true
        if (mFactory instanceof KeyedFactory) {
            viewModel = ((KeyedFactory) (mFactory)).create(key, modelClass);
        } else {
            viewModel = (mFactory).create(modelClass);
        }
        // 将新创建的 ViewModel 存入缓存中
        mViewModelStore.put(key, viewModel);
        return (T) viewModel;
    }

    // ... 省略 ...
}
```

通过上面代码可以得知，get() 方法内部先从 ViewModelStore 中获取是否已经创建过，如果没有创建过，则通过 SavedStateViewModelFactory#create() 方法创建，并将新创建的 ViewModel 存入 ViewModelStore 中。<br/>
那么接下来就看下 SavedStateViewModelFactory#create() 内部实现。

```java
public final class SavedStateViewModelFactory extends ViewModelProvider.KeyedFactory {

    private final Application mApplication;
    private final ViewModelProvider.AndroidViewModelFactory mFactory;
    private final Bundle mDefaultArgs;
    private final Lifecycle mLifecycle;
    private final SavedStateRegistry mSavedStateRegistry;

    // ... 省略 ...

    @SuppressLint("LambdaLast")
    public SavedStateViewModelFactory(@NonNull Application application,
            @NonNull SavedStateRegistryOwner owner,
            @Nullable Bundle defaultArgs) {
        mSavedStateRegistry = owner.getSavedStateRegistry();
        mLifecycle = owner.getLifecycle();
        mDefaultArgs = defaultArgs;
        mApplication = application;
        mFactory = ViewModelProvider.AndroidViewModelFactory.getInstance(application);
    }

    @NonNull
    @Override
    public <T extends ViewModel> T create(@NonNull String key, @NonNull Class<T> modelClass) {
        // 判断是否ViewModel继承自 AndroidViewModel，由于咱们自定义的 ViewModel 继承自 ViewModel,所以这里不成立
        boolean isAndroidViewModel = AndroidViewModel.class.isAssignableFrom(modelClass);
        Constructor<T> constructor;
        if (isAndroidViewModel) {
            constructor = findMatchingConstructor(modelClass, ANDROID_VIEWMODEL_SIGNATURE);
        } else {
            // 内部判断传入的 Class 构造函数是否包含指定参数。
            // 此时咱们自定义的 ViewModel 构造函数未包含所有任何参数，所以这里返回 null
            constructor = findMatchingConstructor(modelClass, VIEWMODEL_SIGNATURE);
        }

        if (constructor == null) {
            // 通过上面步骤可以的值，最后调用 mFactory#create() 进行创建。
            return mFactory.create(modelClass);
        }

        // ... 省略 ...
    }

    // ... 省略 ...
}    
```

通过上面代码可以发现，SavedStateViewModelFactory#create() 内部做了一些校验，但是咱们自定义的 ViewModel 都没有满足，最后通过 ViewModelProvider.AndroidViewModelFactory.getInstance(application)#create() 来创建。那么就看看 AndroidViewModelFactory#create() 内部实现。

```java
public class ViewModelProvider {
    // ... 省略 ...

    public static class AndroidViewModelFactory extends ViewModelProvider.NewInstanceFactory {
        // ... 省略 ...

        @NonNull
        @Override
        public <T extends ViewModel> T create(@NonNull Class<T> modelClass) {
            // 判断是否ViewModel继承自 AndroidViewModel。咱们自定义的 ViewModel 继承自 ViewModel。
            // 所以最后调用 super.create(),即 ViewModelProvider.NewInstanceFactory#create()
            if (AndroidViewModel.class.isAssignableFrom(modelClass)) {
                try {
                    return modelClass.getConstructor(Application.class).newInstance(mApplication);
                } catch (NoSuchMethodException e) {
                    throw new RuntimeException("Cannot create an instance of " + modelClass, e);
                } catch (IllegalAccessException e) {
                    throw new RuntimeException("Cannot create an instance of " + modelClass, e);
                } catch (InstantiationException e) {
                    throw new RuntimeException("Cannot create an instance of " + modelClass, e);
                } catch (InvocationTargetException e) {
                    throw new RuntimeException("Cannot create an instance of " + modelClass, e);
                }
            }
            return super.create(modelClass);
        }
    }

    // ... 省略 ...    

    public static class NewInstanceFactory implements Factory {
        // ... 省略 ...

        @SuppressWarnings("ClassNewInstance")
        @NonNull
        @Override
        public <T extends ViewModel> T create(@NonNull Class<T> modelClass) {
            try {
                // 直接通过 Class.newInstance() 进行创建。
                return modelClass.newInstance();
            } catch (InstantiationException e) {
                throw new RuntimeException("Cannot create an instance of " + modelClass, e);
            } catch (IllegalAccessException e) {
                throw new RuntimeException("Cannot create an instance of " + modelClass, e);
            }
        }
    }

    // ... 省略 ...
}
```

通过上面代码可以知道，AndroidViewModelFactory#create 又进行了校验，最后调用到了 NewInstanceFactory#create() 方法，该方法直接通过 Class.newInstance() 创建了 ViewModel。
至此，ViewModel 的创建过程就走完了。在文章的最后会对该过程有一个总结。

### 从疑问出发

**1. ViewModel 是怎么实现屏幕旋转时仍可保留数据的？**

关于屏幕旋转仍可保留数据的重点，其实需要知道 Activity#onRetainNonConfigurationInstance()，通过该方法的注释可以知道，当有新配置导致重新创建实例时，系统会通过该方法回调通知。

```java
public class Activity{

     // ... 省略 ...

     /**
     * Called by the system, as part of destroying an
     * activity due to a configuration change, when it is known that a new
     * instance will immediately be created for the new configuration.  You
     * can return any object you like here, including the activity instance
     * itself, which can later be retrieved by calling
     * {@link #getLastNonConfigurationInstance()} in the new activity
     * instance.
     * 
     * ... 省略 ...
     * 
     */
    public Object onRetainNonConfigurationInstance() {
        return null;
    }

    // ... 省略 ...
}
```

ComponentActivity 重写了该方法，当屏幕旋转时将 viewModelStore 保存其中，这样当屏幕旋转，重新走 getViewModelStore() 时，先通过 getLastNonConfigurationInstances() 方法就可以获取到之前的 viewModelStore。<br/>
PS: 这里需要注意一点，ComponentActivity#onRetainNonConfigurationInstance() 提到了该方法禁止自己重写！

```java
public class ComponentActivity extends androidx.core.app.ComponentActivity implements
        LifecycleOwner,
        ViewModelStoreOwner,
        HasDefaultViewModelProviderFactory {
    // ... 省略 ...

    @NonNull
    @Override
    public ViewModelStore getViewModelStore() {
        if (mViewModelStore == null) {
            // 从上次配置发生更改(例如屏幕旋转)中获取
            NonConfigurationInstances nc =
                    (NonConfigurationInstances) getLastNonConfigurationInstance();
            if (nc != null) {
                mViewModelStore = nc.viewModelStore;
            }
            if (mViewModelStore == null) {
                mViewModelStore = new ViewModelStore();
            }
        }
        return mViewModelStore;
    }

    // ... 省略 ...

    /**
     * Retain all appropriate non-config state.  You can NOT
     * override this yourself!  Use a {@link androidx.lifecycle.ViewModel} if you want to
     * retain your own non config state.
     */
    @Override
    @Nullable
    public final Object onRetainNonConfigurationInstance() {
        Object custom = onRetainCustomNonConfigurationInstance();

        ViewModelStore viewModelStore = mViewModelStore;
        if (viewModelStore == null) {
            NonConfigurationInstances nc =
                    (NonConfigurationInstances) getLastNonConfigurationInstance();
            if (nc != null) {
                viewModelStore = nc.viewModelStore;
            }
        }

        if (viewModelStore == null && custom == null) {
            return null;
        }

        NonConfigurationInstances nci = new NonConfigurationInstances();
        nci.custom = custom;
        nci.viewModelStore = viewModelStore;
        return nci;
    }

    // ... 省略 ...
}
```

**2. ViewModel 是怎么管理生命周期，在 Activity 销毁时清理数据的？**

```java
public class ComponentActivity extends androidx.core.app.ComponentActivity implements
        LifecycleOwner,
        ViewModelStoreOwner,
        HasDefaultViewModelProviderFactory {
    // ... 省略 ...

    public ComponentActivity() {
        Lifecycle lifecycle = getLifecycle();

        // ... 省略 ...

        // 监听 Activity 的生命周期变化，当收到 Event = ON_DESTROY && 未发生配置更新时，此时为真正销毁，清理所有数据。
        getLifecycle().addObserver(new LifecycleEventObserver() {
            @Override
            public void onStateChanged(@NonNull LifecycleOwner source,
                    @NonNull Lifecycle.Event event) {
                if (event == Lifecycle.Event.ON_DESTROY) {
                    if (!isChangingConfigurations()) {
                        getViewModelStore().clear();
                    }
                }
            }
        });

        // ... 省略 ...
    }

    // ... 省略 ...
}
```

通过上面代码可以发现，依赖于 Lifecycle 提供的生命周期事件，通过 addObserver()，监听 Activity 的生命周期，当接收到 ON_DESTROY 事件并且不是因为配置更新(屏幕旋转)导致的 destroy 时，调用 ViewModelStore#clear() 清理所有数据。

**3. 单Activity多Fragment时，怎么做到Fragment之间共享数据的？**

通过源码分析这个问题其实已经有结论了。当调用 ViewModelProvider() 方法传入的是 getActivity()， ViewModelStore 和 Factory 的创建都是在 Activity 中，所以 ViewModel 的数据也是在 Activity 中，所以相当于用 Activity 来维护数据，然后基于此 Activity 的 Fragment 就都可以访问这些数据。

## 总结

简单总结下 ViewModel 的实现原理：调用 ViewModelProvider() 方法，该方法内部通过接口反向依赖 ViewModelStore 和 Factory 的实现(这里即反向依赖 ComponentActivity 来创建)。然后调用 ViewModelProvider#get() 方法，该方法内部先从 ViewModelStore 中获取缓存，如果没有则调用 Factory#create() 进行创建，经过各种条件校验，最终调用 ViewModelProvider.NewInstanceFactory#create() 方法，通过 Class.newInstance() 创建出来，最后将新创建的 ViewModel 存入 ViewModelStore 中。
下面为调用时序图，可参照自行走一遍源码。
![loading-ag-5083](images/viewModel/2.webp)
