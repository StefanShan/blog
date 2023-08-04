---
title: 调用GradleSync报IncompatibleClassChangeError?
date: 2022/7/14 12:23
categories:
- IDEA 插件开发
tags:
- Intellij IDEA
- Android Studio

---

# 背景

之前开发的 AndroidStudio 插件点击按钮可以切换编译环境，然后自动执行项目的sync。这里 Sync 实现是通过调用官方文档提供的`GradleSyncInvoker.requestProjectSync()`。但在 Android Studio 升级到 `Chipmunk 2021.2.1 patch1` 后项目 sync 的功能点击没有反映了，而且还报了一个错误

```log
2022-07-04 11:56:51,605 [1003391]  ERROR - llij.ide.plugins.PluginManager - Method com.android.tools.idea.gradle.project.sync.GradleSyncInvoker.getInstance()Lcom/android/tools/idea/gradle/project/sync/GradleSyncInvoker; must be InterfaceMethodref constant 
java.lang.IncompatibleClassChangeError: Method com.android.tools.idea.gradle.project.sync.GradleSyncInvoker.getInstance()Lcom/android/tools/idea/gradle/project/sync/GradleSyncInvoker; must be InterfaceMethodref constant
    at com.***.plugin.business.***$createToolWindowContent$2$stateChanged$1$1$2.invoke(**ToolWindowFactory.kt:99)
    at com.***.plugin.business.***$createToolWindowContent$2$stateChanged$1$1$2.invoke(**ToolWindowFactory.kt:77)
    at com.intellij.ui.layout.CellKt$sam$java_awt_event_ActionListener$0.actionPerformed(Cell.kt)
    //....
```

<!-- more -->

# 解决办法

方案1：修改调用方式，调用 `GradleSyncExecutor.sync()`【推荐】

```java
GradleSyncExecutor(project).sync(GradleSyncInvoker.Request(GradleSyncStats.Trigger.TRIGGER_USER_SYNC_ACTION),null)
```

方案2：修改编译环境为本地Android Studio

```groovy
intellij {
//    version = '212.5712.43'
    localPath = '/Applications/Android Studio.app/Contents'// 使用Android Studio 调试
    type = 'IC'
}
```

# 过程

根据目前的报错信息可以得知是 GradleSyncInvoker 类发生了不兼容改动。沿着这个思路先来看下两个版本 GradleSyncInvoker 源码

```java
/**
 * from : Jetbranis idealC 212.5712.43 (Chipmunk Patch 1)
 */
public class GradleSyncInvoker {
  private static final Logger LOG = Logger.getInstance(GradleSyncInvoker.class);

  @NotNull
  public static GradleSyncInvoker getInstance() {
    return ApplicationManager.getApplication().getService(GradleSyncInvoker.class);
  }
//....
}
```

```java
/**
 * from : Jetbranis idealC 203.7717.56 (Arctic Fox Patch 4)
 * https://github.com/JetBrains/android/blob/203.7717/android/src/com/android/tools/idea/gradle/project/sync/GradleSyncInvoker.java
 */
public final class GradleSyncInvoker {
  @NotNull private final FileDocumentManager myFileDocumentManager;
  @NotNull private final PreSyncProjectCleanUp myPreSyncProjectCleanUp;
  @NotNull private final PreSyncChecks myPreSyncChecks;

  @NotNull
  public static GradleSyncInvoker getInstance() {
    return ApplicationManager.getApplication().getService(GradleSyncInvoker.class);
  }

  public GradleSyncInvoker() {
    this(FileDocumentManager.getInstance(), new PreSyncProjectCleanUp(), new PreSyncChecks());
  }

  private GradleSyncInvoker(@NotNull FileDocumentManager fileDocumentManager,
                            @NotNull PreSyncProjectCleanUp preSyncProjectCleanUp,
                            @NotNull PreSyncChecks preSyncChecks) {
    myFileDocumentManager = fileDocumentManager;
    myPreSyncProjectCleanUp = preSyncProjectCleanUp;
    myPreSyncChecks = preSyncChecks;
  }
//...
}
```

根据两个版本的源码，发现并没有什么兼容问题，变更的仅仅是类的内部实现，对外部理论上并没有什么影响。而且按照报错提示的`must be InterfaceMethodref constant`，`GradleSyncInvoker.sync()` 应该是一个接口方法，但新版本(相对AndroidStudio) GradleSyncInvoker 还是一个类呀，这不就神奇了。

本着先解决问题再分析原因的原则，查看了新/旧版本 sync 方法的源码，发现最终都会调用到 `GradleSyncExecutor.sync()` ，而且 GradleSyncExecutor 是一个可创建对象的类，那理论上可以跳过 GradleSyncInvoker 直接调用，经过测试发现的确可行，而且老版本也可运行。

后面[社会我萌哥人狠话也多](https://juejin.cn/user/4072246797155646)同学通过 cs.android.com 查看源码时发现在 Android Studio 部分的 <span data-word-id="54204246" class="abbreviate-word">mirror</span>-goog-sudio-main 分支中 [`GradleSyncInvoker` ](https://cs.android.com/android-studio/platform/tools/adt/idea/+/mirror-goog-studio-main:project-system-gradle/src/com/android/tools/idea/gradle/project/sync/GradleSyncInvoker.kt;l=28?q=GradleSyncInvoker&sq=&ss=android-studio%2Fplatform%2Ftools%2Fadt%2Fidea)的确是一个接口类，跟报错的提示信息完全吻合。但是为什么查看 `JetBrains/android`仓库下的 GradleSyncInvoker 是一个类呢？按照 `JetBrains/android` 仓库中的描述 “此库是 Intellij 平台的 Android 插件代码，也是 Android Sudio 的重要部分”，基于两个库中代码的差异和`JetBrains/android`仓库的描述，盲猜可能是 IntelliJ IDEA 中的 android plugin 与 Android Studio 中代码不完全一致导致的。

经过[社会我萌哥人狠话也多](https://juejin.cn/user/4072246797155646)同学验证发现，当把编译环境替换为本地 Android Studio 时就可以正常编译通过。侧面验证了 IntelliJ IDEA 中的 android plugin 与 Android Studio 中的实现并不是一致的，可以理解为这是官方给留下的坑，Android Studio 在基于 Intellij 开发新版本时，没有及时更新 IntelliJ 对应的 android plugin 和对应的官方文档。关于此坑避免方法已经在上面提及，当然如果以后开发仅运行在 Android Studio 中的插件还是用本地 Android Studio 来编译运行吧。
