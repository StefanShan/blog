---
title: IDEA 插件开发之线程处理
date: 2022/8/16 14:37:00
categories:
- IDEA 插件开发
tags:
- Intellij IDEA
- Android Studio
- IDEA插件开发

---

> 本文翻译总结自官方文档 [General Threading Rules](https://plugins.jetbrains.com/docs/intellij/general-threading-rules.html#0)

# 读写操作

> 访问 PSI(Program Structure Interface)、VFS(Virtual File System)、Project root model 时，只能通过以下方式进行读写操作，否则会运行报错。

## 读操作

读操作没有线程约束。在非UI线程中可通过调用 `ApplicationManager.getApplication().runReadAction()` 或 `ReadAction.run()` 或 `ReadAction.compute()` 执行读操作。根据经验，在读取 PSI/VFS/project/modules 前要判断这些文件是否有效。

## 写操作

写操作只能在UI线程中，并且只能通过调用 `ApplicatioinManager.getApplication().runWriteAction()` 或 `WriteAction.run()` 或 `WriteAction.compute()` 执行写操作。只能在 user action 或 invokeLater() 中修改模型数据(PSI/VFS/project model)，禁止在 UI 线程或 `SwingUtilities.invokeLater()` 中修改。

<!-- more -->

# 子线程切到事件分发线程(后台线程切到EDT)

插件应该通过调用 `ApplicationManager.getApplication().invokeLater()` 从后台线程切换至事件分发线程(Event Dispatch Thread,EDT)，而不是通过调用 `SwingUtilities.invokeLater()` 来实现。并且 `ApplicationManager.getApplication().invokeLater()` 还支持指定 modality state (模态)。

- ModalityState.NON_MODAL
  
  该操作将在所有模态对话框关闭后执行。模态对话框是指必须用户操作的弹窗。

- ModalityState.stateForComponent()
  
  该操作将在顶部显示弹窗或父级弹窗中包含指定组件(component)后执行。

- ModalityState.defaultModalityState()（None Specified）
  
  在大多数情况下这是最佳选择。

- ModalityState.any()
  
  该操作将不管模态对话框，直接执行。不能再该模态下修改 PSI/VFS/project model。

如果有操作需要基于文件的索引（例如：PSI 解析，解析引用等），则应该调用 DumbService.smartInvokerLater() 方法保证在索引进程完成后执行。

# 后台进程

后台进程由 `ProcessManager` 管理，它提供了能多方法在模态(对话框)、非模态(状态栏中可见)或不可见进度中执行给定的代码。在所有情况中，后台线程执行的代码都需要与 `ProcessIndicator` 对象关联，可通过调用 `ProcessIndicatorProvider.getGlobalProgressIndicator()` 获取当前线程的指示器(Indicator)。 对于可见进度的进程，可通过 `ProcessIndicator` 通知用户当前的状态。

进程指示器(Process Indicator) 提供了 `ProgressIndicator.cancel()` 用于取消当前进程，取消操作通常不能由进程本身触发，而应该由其他外部活动调用，例如，用户按下"取消"按钮，或者通过其他识别无用线程的代码。可被取消的后台进程应该内部调用 `ProgressIndicator.checkCanceled()` 或 `ProcessManager.checkCanceled()`(当没有 Indicator时) 来检查进程是否被取消，如果被取消，则调用该方法会抛出 `PrcessCanceledException` ，该异常用于立即停止，不应该被 try/catch 住。

后台线程不应长时间进行读操作，否则 UI 将冻结，直到所有后台线程完成读操作。最好的方法是，当有写操作时先取消后台的读操作，之后再重新开启读操作。编辑器的高亮、代码补全、goto class/file 就是这么实现的。为了实现这一点，耗时的后台操作应该通过 `ProcessIndicator` 启动，并在写操作开始时通过该指示器发起取消，这样进行下一个读操作时，后台线程调用 `checkCanceled()` 就会抛出 `ProcessCanceledException` 来停止操作。这里提供两个方法来实现：

- 如果在 UI 线程中，可以用调用 `ReadAction.nonBlocking()` 开启不阻塞的读操作。该方法返回一个 `NonBlockingReadAction` 对象，可以调用 `expireWith()` 或 `expireWhen()` 来判定什么时候取消。如果操作需要文件索引，则可以调用 `ReadAction.nonBlocking(...).inSmartMode()`。

- 如果已经在后台线程中，则调用 `ProcessManager.getInstance().runInReadActionWithWriteActionPriority()`，该方法如果返回 false，则说明读取操作失败，失败的情况有：
  
  - 调用该方法时，正在执行写入操作；
  
  - 调用该方法时，写入操作处于挂起状态；
  
  - 操作开始执行，但在其他线程启动写入操作时通过 `ProcessCanceledException` 给终止了。
