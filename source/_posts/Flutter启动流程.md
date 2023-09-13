---
title: Flutter 启动流程
date: 2023/03/20
categories:
- [Flutter]
- [源码解读]
---

```dart
void main() {
  runApp(const MyApp());
}
```
```dart
void runApp(Widget app) {
  WidgetsFlutterBinding.ensureInitialized()  //创建 WidgetsFlutterBinding 对象
    ..scheduleAttachRootWidget(app)  //绑定根节点
    ..scheduleWarmUpFrame();  //绘制热身帧
}
```
<!-- more -->
### 创建 WidgetsFlutterBinding 对象
```dart
class WidgetsFlutterBinding extends BindingBase with GestureBinding, SchedulerBinding, ServicesBinding, PaintingBinding, SemanticsBinding, RendererBinding, WidgetsBinding {
  static WidgetsBinding ensureInitialized() {
    if (WidgetsBinding._instance == null) {
      WidgetsFlutterBinding();
    }
    return WidgetsBinding.instance;
  }
}
```
该类只有一个创建单例对象的方法，看似简单，其实大部分逻辑都在父类 (BindingBase) 以及混入的类(GestureBinding 等) 中。
#### BindingBase
只有两个方法，而且这两个方法都需要子类来实现。
```dart
abstract class BindingBase{

  BindingBase() {
  	// 执行初始化逻辑
    initInstances();
    // 实现了该方法的mixin按调用顺序为WidgetsBinding-->RendererBinding-->SchedulerBinding-->ServicesBinding
    // 主要就是在debug模式下注册相关拓展服务。
    initServiceExtensions();
    
  }

  ///.....

  //获取 PlatformDispatcher 单例，供子类来使用。
  ui.PlatformDispatcher get platformDispatcher => ui.PlatformDispatcher.instance;

  ///....
}
```
##### PlatformDispatcher

- 平台事件调度器。主机操作系统界面的最基本界面。
- 这是来自平台的平台消息和配置事件的中央入口点。
- 它公开了核心调度程序 API、输入事件回调、图形绘制 API 和其他此类核心服务。
- 它管理应用程序的views列表和附加到设备的screens ，以及各种平台属性的configuration 。
#### GestureBinding
手势处理的 Binding ，主要处理触屏幕指针事件的分发以及事件最终回调处理。
```dart
mixin GestureBinding on BindingBase implements HitTestable, HitTestDispatcher, HitTestTarget {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    platformDispatcher.onPointerDataPacket = _handlePointerDataPacket; //注册触摸指针回调
  }
}
```
#### SchedulerBinding
绘制相关处理的 Binding
```dart
mixin SchedulerBinding on BindingBase {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
  }
}
```
#### ServicesBinding

- 构建与原生之间通信的 BinaryMessenger
- 监听系统消息，只监听了“内存紧张”消息，来处理。
- 监听 flutter app 生命周期，根据生命周期状态决定是否允许发起绘制任务
```dart
mixin ServicesBinding on BindingBase, SchedulerBinding {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    // 构建一个用于platform与flutter层通信的 BinaryMessenger
    _defaultBinaryMessenger = createBinaryMessenger();
    _restorationManager = createRestorationManager();
    _initKeyboard();
    initLicenses();
    // 设置处理platform发送的系统消息的 Handler
    SystemChannels.system.setMessageHandler((dynamic message) => handleSystemMessage(message as Object));
    // 设置AppLifecycleState生命周期回调
    SystemChannels.lifecycle.setMessageHandler(_handleLifecycleMessage);
    // 设置处理platform发送的消息
    SystemChannels.platform.setMethodCallHandler(_handlePlatformMessage);
    TextInput.ensureInitialized();
    // AppLifecycleState 为 resumed 和 inactive 时才允许响应Vsync信号进行绘制
    readInitialLifecycleStateFromNativeWindow();
  }
}
```
#### PaintingBinding

- 创建图片缓存
- 在绘制热身帧之前预热Skia渲染引擎
- 监听系统消息，仅监听文字大小变化，并处理。注意这里有 super，也就意味着先走 ServicesBinding#handleSystemMessage() 。
```dart
mixin PaintingBinding on BindingBase, ServicesBinding {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    _imageCache = createImageCache(); //创建图片缓存
    shaderWarmUp?.execute();  //在绘制热身帧之前预热Skia渲染引擎
  }

  @override
  Future<void> handleSystemMessage(Object systemMessage) async {
    await super.handleSystemMessage(systemMessage);
    final Map<String, dynamic> message = systemMessage as Map<String, dynamic>;
    final String type = message['type'] as String;
    switch (type) {
      case 'fontsChange':
        _systemFonts.notifyListeners();
        break;
    }
    return;
  }
}
```
#### SemanticsBinding
渲染器辅助类，语义层和 Flutter 引擎之间的粘合剂。
> Flutter维护了一个 semantic tree（语义树），页面构建的时候会根据各Widget的语义描述构建一棵 semantic tree。如在Image组件中配置 semanticLabel 语义内容，用户在IOS/Android手机开启无障碍功能时，触摸到该 Image 时通过语义树查找到对应的语义描述交给Flutter Engine，实现读屏等功能。

```dart
mixin SemanticsBinding on BindingBase {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    _accessibilityFeatures = platformDispatcher.accessibilityFeatures;
  }
}
```
#### RendererBinding
渲染绑定，RendererBinding是render tree 与 Flutter engine的粘合剂，它持有了render tree的根节点 renderView
```dart
mixin RendererBinding on BindingBase, ServicesBinding, SchedulerBinding, GestureBinding, SemanticsBinding, HitTestable {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;

    // 初始化PipelineOwner管理渲染流程
    _pipelineOwner = PipelineOwner(
      onNeedVisualUpdate: ensureVisualUpdate, //触发UI绘制
      onSemanticsOwnerCreated: _handleSemanticsOwnerCreated,
      onSemanticsUpdate: _handleSemanticsUpdate,
      onSemanticsOwnerDisposed: _handleSemanticsOwnerDisposed,
    );
    
    // 设置window的屏幕参数变化、文本缩放因子变化、亮度等变化、语义启用等回调。
    platformDispatcher
      ..onMetricsChanged = handleMetricsChanged
      ..onTextScaleFactorChanged = handleTextScaleFactorChanged
      ..onPlatformBrightnessChanged = handlePlatformBrightnessChanged
      ..onSemanticsEnabledChanged = _handleSemanticsEnabledChanged
      ..onSemanticsAction = _handleSemanticsAction;

    // 初始化一个RenderView作为render tree的根节点，作为渲染执行入口
    initRenderView();

    // 设置是否根据render tree生成语义树
    _handleSemanticsEnabledChanged();

    // 绘制回调
    addPersistentFrameCallback(_handlePersistentFrameCallback);

    // 初始化鼠标监听
    initMouseTracker();
  }
}
```
#### WidgetsBinding
WidgetsBinding属于最外层的 mixin，作为处理 Widget 相关事件的入口。在初始化过程中主要是生成了 BuildOwner 实例，以及window的onBeginFrame、onDrawFrame 回调，后面渲染流程会用到。
```dart
mixin WidgetsBinding on BindingBase, ServicesBinding, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;

    // 初始化BuildOwnder，处理需要绘制的Element的构建工作
    _buildOwner = BuildOwner();
    
    // 通过SchedulerBinding初始化window的onBeginFrame、onDrawFrame回调
    // 如果app可见，通过window.scheduleFrame向engine发起绘制请求
    buildOwner!.onBuildScheduled = _handleBuildScheduled;

    // 语言环境变化处理
    platformDispatcher.onLocaleChanged = handleLocaleChanged;

    // platform访问权限变化处理
    platformDispatcher.onAccessibilityFeaturesChanged = handleAccessibilityFeaturesChanged;

    // 处理系统发送的push/pop页面请求
    SystemChannels.navigation.setMethodCallHandler(_handleNavigationInvocation);
    platformMenuDelegate = DefaultPlatformMenuDelegate();
  }
```
### 绑定根节点
```dart
mixin WidgetBinding{

  void scheduleAttachRootWidget(Widget rootWidget) {
    Timer.run(() {
      attachRootWidget(rootWidget);
    });
  }
  
  void attachRootWidget(Widget rootWidget) {
    final bool isBootstrapFrame = renderViewElement == null;
    _readyToProduceFrames = true;

    //创建 RenderObjectToWidgetAdapter，这是一个 Widget。
    // 然后将传入的 widget (rootWidget) 绑定到根节点中。
    _renderViewElement = RenderObjectToWidgetAdapter<RenderBox>(
      container: renderView,
      debugShortDescription: '[root]',
      child: rootWidget,
    ).attachToRenderTree(buildOwner!, renderViewElement as RenderObjectToWidgetElement<RenderBox>?);
    if (isBootstrapFrame) {
      SchedulerBinding.instance.ensureVisualUpdate();  //冷启动首帧渲染，需要等待 Vsync 信号。
    }
  }
}
```
```dart
class RenderObjectToWidgetAdapter<T extends RenderObject> extends RenderObjectWidget {
  
  RenderObjectToWidgetElement<T> attachToRenderTree(BuildOwner owner, [ RenderObjectToWidgetElement<T>? element ]) {
    if (element == null) {
      owner.lockState(() {
        // 创建了一个RenderObjectToWidgetElement实例作为element tree的根节点
        element = createElement();
        // 绑定BuildOwner
        element!.assignOwner(owner);
      });

      // 标记需要构建的element，并rebuild
      owner.buildScope(element!, () {
        element!.mount(null, null);
      });
    } else {
      element._newWidget = this;
      element.markNeedsBuild();
    }
    return element!;
  }

  @override
  RenderObjectToWidgetElement<T> createElement() => RenderObjectToWidgetElement<T>(this);
}
```
### 绘制热身帧
```dart
mixin SchedulerBinding on BindingBase {
  
	// 安排帧尽快运行，而不是等待引擎请求帧以响应系统“Vsync”信号。
  // 这在应用程序启动期间使用，以便第一帧（可能非常昂贵）运行几毫秒。
  // 锁定事件调度，直到计划的帧完成。
  // 如果已经使用scheduleFrame或scheduleForcedFrame安排了一个帧，则此调用可能会延迟该帧。
  // 如果任何计划的帧已经开始或者如果另一个scheduleWarmUpFrame已经被调用，这个调用将被忽略。
  void scheduleWarmUpFrame() {
    if (_warmUpFrame || schedulerPhase != SchedulerPhase.idle) {
      return;
    }

    _warmUpFrame = true;
    final TimelineTask timelineTask = TimelineTask()..start('Warm-up frame');
    final bool hadScheduledFrame = _hasScheduledFrame;
    // Timer任务会加入到event queue
    // 所以在执行绘制前先处理完microtask queue中的任务
    Timer.run(() {
      // 绘制Frame前工作，主要是处理Animate动画
      handleBeginFrame(null); 
    });
    Timer.run(() {
      // 开始Frame绘制
      handleDrawFrame();
      // 重置时间戳，避免热重载情况从热身帧到热重载帧的时间差，导致隐式动画的跳帧情况。
      resetEpoch();
      _warmUpFrame = false;
      if (hadScheduledFrame) {
        // 后续Frame绘制请求
        scheduleFrame();
      }
    });
    lockEvents(() async {
      await endOfFrame;
      timelineTask.finish();
    });
  }

  void handleDrawFrame() {
    try {
      // 处理渲染管线
      _schedulerPhase = SchedulerPhase.persistentCallbacks;

      // 遍历 _persistentCallbacks 触发绘制。
      // 在 RendererBinding 初始化时有注册回调。参考 RendererBinding 部分第 30 行代码。
      for (final FrameCallback callback in _persistentCallbacks) {
        _invokeFrameCallback(callback, _currentFrameTimeStamp!);
      }

      // 处理渲染收尾工作
      _schedulerPhase = SchedulerPhase.postFrameCallbacks;
      final List<FrameCallback> localPostFrameCallbacks =
          List<FrameCallback>.of(_postFrameCallbacks);
      _postFrameCallbacks.clear();
      for (final FrameCallback callback in localPostFrameCallbacks) {
        _invokeFrameCallback(callback, _currentFrameTimeStamp!);
      }
    } finally {
      //更新为 idle(空闲）状态
      _schedulerPhase = SchedulerPhase.idle;
      _frameTimelineTask?.finish(); // end the Frame
      _currentFrameTimeStamp = null;
    }
  }
}
```
```dart
mixin RendererBinding{

  void _handlePersistentFrameCallback(Duration timeStamp) {
    
    // 触发渲染
    drawFrame();

    ///....
  }
}
```
### 总结

1. 通过 mixin 机制，创建了 WidgetsFlutterBinding 对象，同时初始化了混入的"父类"。
2. 将传入的 widget 绑定到 renderView 中，并创建 element，标记为需渲染，然后触发新的一帧请求，等待 Vsync 信号到来后开始渲染。
3. 通过直接调用绘制，触发渲染，跳转等待 Vsync 信号，触发首次渲染。

---

### 参考：
[Flutter APP 启动过程源码分析](https://www.jianshu.com/p/6994f65be6f9)<br />[《Flutter 实战》](https://book.flutterchina.club/chapter14/flutter_app_startup.html#_14-3-2-%E6%B8%B2%E6%9F%93%E7%AE%A1%E7%BA%BF)
