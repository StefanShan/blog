---
title: 多语言切换在Androidx失效
date: 2021/1/9 21:27:00
categories:
- 踩坑记录/问题合集
tags: 
- Android
- AndroidX
- 多语言
---

## 快速定位与修复

出现问题时的调用方式：

```java
public class I18nBaseActivity extends AppCompatActivity {
    @Override
    protected void attachBaseContext(Context newBase) {
      	//切换多语言，然后将新生成的 context 覆盖给 attachBaseContext()
        Context context = MultiLanguageUtils.changeContextLocale(newBase);
        super.attachBaseContext(context);
    }
}
```
<!-- more -->

解决方法：

Androidx(appcompat:1.2.0) 中对`attachBaseContext()`包装了一层`ContextThemeWrapper`，但就是因为他给包的这一层逻辑有问题，导致了多语言切换时效。所以咱们手动给包一层

```java
public class I18nBaseActivity extends AppCompatActivity {
    @Override
    protected void attachBaseContext(Context newBase) {
      	//切换多语言，然后将新生成的 context 覆盖给 attachBaseContext()
        Context context = MultiLanguageUtils.changeContextLocale(newBase);
       //兼容appcompat 1.2.0后切换语言失效问题
        final Configuration configuration = context.getResources().getConfiguration();
        final ContextThemeWrapper wrappedContext = new ContextThemeWrapper(context,
                R.style.Base_Theme_AppCompat_Empty) {
            @Override
            public void applyOverrideConfiguration(Configuration overrideConfiguration) {
                if (overrideConfiguration != null) {
                    overrideConfiguration.setTo(configuration);
                }
                super.applyOverrideConfiguration(overrideConfiguration);
            }
        };
        super.attachBaseContext(wrappedContext);
    }
}
```

### 封装

上面仅说明了怎么解决问题，没有体现多语言切换的实现。所以我封装了一个库(实质就是一个工具类)，该库已经适配了该问题，大家可以直接copy出来使用

> Github : https://github.com/StefanShan/MulituLanguage

## 详细排查过程与原理

最近项目升级为 Androidx，发现之前的多语言切换失效了。经过一点点排除方式排查，发现是由于升到 Androidx 后项目引入了 `androidx.appcompat:appcompat:1.2.0`来替代之前的`v7`包。那么根据多语言切换原理来看看是什么原因。

> 多语言切换原理：修改 context 的 Locale 配置，将新生成的 context 设置给 attachBaseContext 实现配置的替换。

先来看下 androidx 下的 AppCompatActivity# attachBaseContext() 源码

```java
@Override
protected void attachBaseContext(Context newBase) {
  super.attachBaseContext(getDelegate().attachBaseContext2(newBase));
}
```

哦~ 有个代理类处理了传入的 context，看下这个代理类 `getDelegate()` 的`attachBaseContext2()`

```java
/**
 * @return The {@link AppCompatDelegate} being used by this Activity.
*/
@NonNull
public AppCompatDelegate getDelegate() {
  if (mDelegate == null) {
    mDelegate = AppCompatDelegate.create(this, this);	//代理对象是通过 AppCompatDelegate create出来的，那继续往下看
  }
  return mDelegate;
}
```

```java
// 这里直接看 AppCompatDelegateImpl 类，该类是 AppCompatDelegate 类的实现类

@NonNull
@Override
@CallSuper
public Context attachBaseContext2(@NonNull final Context baseContext) {
  //......

  /**
  * 这段逻辑是：如果传入的 context 是经过 ContextThemeWrapper 封装的，则直接使用该 context 配置进行覆盖
  */
  // If the base context is a ContextThemeWrapper (thus not an Application context)
  // and nobody's touched its Resources yet, we can shortcut and directly apply our
  // override configuration.
  if (sCanApplyOverrideConfiguration
      && baseContext instanceof android.view.ContextThemeWrapper) {
    final Configuration config = createOverrideConfigurationForDayNight(
      baseContext, modeToApply, null);
    if (DEBUG) {
      Log.d(TAG, String.format("Attempting to apply config to base context: %s",
                               config.toString()));
    }

    try {
      ContextThemeWrapperCompatApi17Impl.applyOverrideConfiguration(
        (android.view.ContextThemeWrapper) baseContext, config);
      return baseContext;
    } catch (IllegalStateException e) {
      if (DEBUG) {
        Log.d(TAG, "Failed to apply configuration to base context", e);
      }
    }
  }

  // ......

  /**
  * 下面这段逻辑是：通过 packageManger 获取配置，然后和传入的 context 配置进行对比，覆盖修改过的配置。
  * 这里有个关键因素，通过 packageManager 获取的配置与 context 的配置进行 diff 更新，并将 diff 结果赋值给新建的 configration。这就会导致，当这一次切换成功后，杀死进程下次启动时，由于 packageManager 配置的语言 与 context 配置的语言一致，而直接跳过，并没有给新建的 configration进行赋值。最终导致多语言切换失效。同理，从 ActivityA 设置了多语言，然后重启 ActivityA，再从ActivityA 跳转到 ActivityB，此时ActivityB 多语言并没有生效。
  */
  // We can't trust the application resources returned from the base context, since they
  // may have been altered by the caller, so instead we'll obtain them directly from the
  // Package Manager.
  final Configuration appConfig;
  try {
    appConfig = baseContext.getPackageManager().getResourcesForApplication(
      baseContext.getApplicationInfo()).getConfiguration();
  } catch (PackageManager.NameNotFoundException e) {
    throw new RuntimeException("Application failed to obtain resources from itself", e);
  }

  // The caller may have directly modified the base configuration, so we'll defensively
  // re-structure their changes as a configuration overlay and merge them with our own
  // night mode changes. Diffing against the application configuration reveals any changes.
  final Configuration baseConfig = baseContext.getResources().getConfiguration();
  final Configuration configOverlay;
  if (!appConfig.equals(baseConfig)) {
    configOverlay = generateConfigDelta(appConfig, baseConfig);		//这里是关键
    if (DEBUG) {
      Log.d(TAG,
            "Application config (" + appConfig + ") does not match base config ("
            + baseConfig + "), using base overlay: " + configOverlay);
    }
  } else {
    configOverlay = null;
    if (DEBUG) {
      Log.d(TAG, "Application config (" + appConfig + ") matches base context "
            + "config, using empty base overlay");
    }
  }

  final Configuration config = createOverrideConfigurationForDayNight(
    baseContext, modeToApply, configOverlay);
  if (DEBUG) {
    Log.d(TAG, String.format("Applying night mode using ContextThemeWrapper and "
                             + "applyOverrideConfiguration(). Config: %s", config.toString()));
  }

  // Next, we'll wrap the base context to ensure any method overrides or themes are left
  // intact. Since ThemeOverlay.AppCompat theme is empty, we'll get the base context's theme.
  final ContextThemeWrapper wrappedContext = new ContextThemeWrapper(baseContext,
                                                                     R.style.Theme_AppCompat_Empty);
  wrappedContext.applyOverrideConfiguration(config);

  // ......

  return super.attachBaseContext2(wrappedContext);
}
```

```java
@NonNull
private static Configuration generateConfigDelta(@NonNull Configuration base,
                                                 @Nullable Configuration change) {
  final Configuration delta = new Configuration();
  delta.fontScale = 0;

  //......
  
  //这里可以看到，如果两个配置相等，则直接跳过了，并没有给新创建的 delta 的 locale 赋值。
  if (Build.VERSION.SDK_INT >= 24) {
    ConfigurationImplApi24.generateConfigDelta_locale(base, change, delta); 
  } else {
    if (!ObjectsCompat.equals(base.locale, change.locale)) {	
      delta.locale = change.locale;
    }
  }
  
	//......
}
```

Ok，上面注释已经非常清晰了。这里简单总结下：

> `AppCompatActivity# attachBaseContext()` 方法在 Androidx 进行了包装，具体实现在 `AppCompatDelegateImpl# attachBaseContext2() `。该包装方法实现了两套逻辑：
>
> 1. 传入的 context 是经过 ContextThemeWrapper 封装的，则直接使用该 context 配置(包含语言)进行覆盖
> 2. 传入的 context 未经过 ContextThemeWrapper 封装，则从 PackageManger 中获取配置(包含语言)，然后和传入的 context 配置(包含语言)进行对比，并新创建了一个 configration 对象，如果两者有对比不同的配置则赋值给这个 configration，如果相同则跳过，最后将这个新建的 configration 作为最终配置结果进行覆盖。
>
> 而多语言问题就出现在 [2] 这套逻辑上，如果 PackageManager 与 传入的 context 某个配置项一致时就不会给新建的 configration 赋值该配置项。这就会导致当这一次切换成功后，杀死进程下次启动时，由于 packageManager 配置的语言 与 context 配置的语言一致，而直接跳过，并没有给新建的 configration进行赋值，最终表现就是多语言失效。

