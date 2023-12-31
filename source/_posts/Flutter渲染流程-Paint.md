---
title: Flutter 渲染流程 - Paint
date: 2023/03/29
categories:
- [Flutter]
- [源码解读]
---

# Paint过程
在渲染流程中，fushPaint() 最终会调用 RenderObject#paint() 实现绘制。这个方法由子类来实现。<br />这里以 RichText Widget 为例。RichText 对应的 RenderObject 实例为 RenderParagraph 。
```dart
class RenderParagraph extends RenderBox{
  void paint(PaintingContext context, Offset offset) {
  	//...

    //这里裁剪比较多，主要是一些详细的绘制工作，可忽略。
    //咱们看这里通过 context.canvas 拿到了 canvas 来绘制。
    _textPainter.paint(context.canvas, offset);

    //...
    super.paint(context, offset);
  }
}
```
<!-- more -->
```dart
class PaintingContext{
  
  Canvas get canvas {
    if (_canvas == null) {
      //如果为 null 则创建
      _startRecording();
    }
    return _canvas!;
  }

  void _startRecording() {
  	//创建一个 PictureLayer，大小为控件的大小。
    _currentLayer = PictureLayer(estimatedBounds);
    //创建 Recorder，用于记录绘制内容，并绑定到 Canvas 中
    _recorder = ui.PictureRecorder(); 
    _canvas = Canvas(_recorder!);
    //将创建的 PictureLayer 添加到 OffsetLayer 中。
    _containerLayer.append(_currentLayer!);
  }
}
```
Ok，到这里整个绘制过程就结束了。是不是有点乱，咱们再捋一下整个过程：<br />![](../iamges/flutter渲染流程-Paint/1.webp)<br />对应代码流程为：
```dart
	// 1.创建绘制记录器和Canvas
  PictureRecorder recorder = PictureRecorder();
  Canvas canvas = Canvas(recorder);

  // 2.在指定位置区域绘制。
  var rect = Rect.fromLTWH(30, 200, 300,300 );

  // 3.绘制内容，每个 widget(RenderObject) 自己实现
  drawCustom(canvas,rect);

  // 4.创建layer，将绘制的产物保存在layer中
  var pictureLayer = PictureLayer(rect);
  //recorder.endRecording()获取绘制产物。
  pictureLayer.picture = recorder.endRecording();
  var rootLayer = OffsetLayer();
  rootLayer.append(pictureLayer);

  //5.上屏，将绘制的内容显示在屏幕上。
	//这一步在渲染流程最后一步(compositeFrame()) 执行。
  final SceneBuilder builder = SceneBuilder();
  final Scene scene = rootLayer.buildScene(builder);
  window.render(scene);
```
# 补充知识：
## Picture
## Layer

- OffsetLayer：它继承自ContainerLayer，而ContainerLayer继承自 Layer 类，我们将直接继承自ContainerLayer 类的 Layer 称为**容器类Layer**，容器类 Layer 可以添加任意多个子Layer。
- PictureLayer：保存绘制产物的 Layer，它直接继承自 Layer 类。我们将可以直接承载（或关联）绘制结果的 Layer 称为**绘制类 Layer**
### 容器Layer
它的作用和具体使用场景:

1. 将组件树的绘制结构组成一棵树。

因为 Flutter 中的 Widget 是树状结构，那么相应的 RenderObject 对应的**绘制结构**也应该是树状结构，Flutter 会根据一些“特定的规则”（后面解释）为组件树生成一棵 Layer 树，而容器类Layer就可以组成树状结构（父 Layer 可以包含任意多个子 Layer，子Layer又可以包含任意多个子Layer）。

2. 可以对多个 layer 整体应用一些变换效果。

容器类 Layer 可以对其子 Layer 整体做一些变换效果，比如剪裁效果（ClipRectLayer、ClipRRectLayer、ClipPathLayer）、过滤效果（ColorFilterLayer、ImageFilterLayer）、矩阵变换（TransformLayer）、透明变换（OpacityLayer）等。
### 绘制Layer
我们知道最终显示在屏幕上的是位图信息，而位图信息正是由 Canvas API 绘制的。实际上，Canvas 的绘制产物是 Picture 对象表示，而当前版本的 Flutter 中只有 PictureLayer 才拥有 picture 对象，换句话说，Flutter 中通过Canvas 绘制自身及其子节点的组件的绘制结果最终会落在 PictureLayer 中。
### 容器类 Layer 实现变换效果的原理
容器类 Layer的变换在底层是通过 Skia 来实现的，不需要 Canvas 来处理。<br />有变换功能的容器类 Layer 会对应一个 Skia 引擎中的 Layer，为了和Flutter framework中 Layer 区分，flutter 中将 Skia 的Layer 称为 engine layer。而有变换功能的容器类 Layer 在添加到 Scene 之前就会构建一个 engine layer，我们以 OffsetLayer 为例。OffsetLayer 对其子节点整体做偏移变换的功能是 Skia 中实现支持的。Skia 可以支持多层渲染，但并不是层越多越好，engineLayer 是会占用一定的资源，Flutter 自带组件库中涉及到变换效果的都是优先使用 Canvas 来实现，如果 Canvas 实现起来非常困难或实现不了时才会用 ContainerLayer 来实现。
