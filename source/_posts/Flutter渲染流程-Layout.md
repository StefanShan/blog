---
title: Flutter 渲染流程 - Layout
date: 2023/03/25
categories:
- [Flutter]
- [源码解读]
---

# Layout 过程
在渲染流程中，fushLayout() 最终会调用 RenderObject#layout() 实现重新布局，而 RenderObject#layout() 官方不建议子类重写，而应该重写 performLayout() 或 performResize() 来实现子类布局。

<!-- more -->

```dart
abstract class RenderObject extends AbstractNode with DiagnosticableTreeMixin implements HitTestTarget {
  
  void layout(Constraints constraints, { bool parentUsesSize = false }) {

    // 判断是否为布局边界
    // parentUsesSize = false， 表示父布局不依赖自己的大小，所以自己怎么变化都不会影响到父布局，父布局及父布局以上的布局都不需要重新布局，那么自己就是布局边界。
    // sizedByParent = true， 子布局不能更改约束，即子布局约束固定，而且不依赖它的子布局大小（如果它也有孩子），所以自己变化不影响上层布局，自己就是布局边界。
    // constraints.isTight，表示父布局给的约束是一个固定的，所以自己变化不会影响父布局，自己就是布局边界。
    // parent is! RenderObject = ture，表示当前组件是根组件，因为只有根组件没有父组件，那必须是布局边界了。
    final bool isRelayoutBoundary = !parentUsesSize || sizedByParent || constraints.isTight || parent is! RenderObject;
    
    final RenderObject relayoutBoundary = isRelayoutBoundary ? this : (parent! as RenderObject)._relayoutBoundary!;

    //自己不需要重新布局，并且父布局给自己的约束不变，则不需要再执行布局了。
    if (!_needsLayout && constraints == _constraints) {
      return;
    }
    
    _constraints = constraints;

    _relayoutBoundary = relayoutBoundary;
    
    if (sizedByParent) {
      try {
        performResize(); //根据父布局约束，重新计算自己的大小
      } catch (e, stack) {
        _reportException('performResize', e, stack);
      }
      
    }

    try {
      performLayout();  //真正的布局
    } catch (e, stack) {
      _reportException('performLayout', e, stack);
    }
    
    _needsLayout = false;
    markNeedsPaint();  //标记需要重新绘制
  }
}
```
这里以 Align 为例：Align 是一个 Widget，它的 RenderObject 是由 RenderPositionedBox  实现。
```dart
class RenderPositionedBox extends RenderAligningShiftedBox {
  @override
  void performLayout() {
    final BoxConstraints constraints = this.constraints;
    final bool shrinkWrapWidth = _widthFactor != null || constraints.maxWidth == double.infinity;
    final bool shrinkWrapHeight = _heightFactor != null || constraints.maxHeight == double.infinity;

    if (child != null) {
      // 调用子布局的 layout()。
      // constraints.loosen() 表示将约束传递给子布局（不限制最小，但限制最大）
      // parentUsesSize: true 表示父布局(Align) 需要依赖子布局的大小
      child!.layout(constraints.loosen(), parentUsesSize: true);
      // 根据子布局的大小得到自己(Align)的大小。
      size = constraints.constrain(Size(
        shrinkWrapWidth ? child!.size.width * (_widthFactor ?? 1.0) : double.infinity,
        shrinkWrapHeight ? child!.size.height * (_heightFactor ?? 1.0) : double.infinity,
      ));
      // 计算出子布局偏移量，然后保存到子布局的 parentData 中
      alignChild();
    } else {
      size = constraints.constrain(Size(
        shrinkWrapWidth ? 0.0 : double.infinity,
        shrinkWrapHeight ? 0.0 : double.infinity,
      ));
    }
  }

   @protected
  void alignChild() {
    final BoxParentData childParentData = child!.parentData! as BoxParentData;
    childParentData.offset = _resolvedAlignment!.alongOffset(size - child!.size as Offset);
  }
}
```
# 补充知识
## ParentData
> 上面例子中我们在实现相应的 RenderObject 时都用到了子节点的 parentData 对象(将子节点的offset信息保存其中)，可以看到 parentData 虽然属于child的属性，但它从设置（包括初始化）到使用都在父节点中，这也是为什么起名叫“parentData”。实际上Flutter框架中，parentData 这个属性主要就是为了在 layout 阶段保存组件布局信息而设计的。
> 需要注意：“parentData 用于保存节点的布局信息” 只是一个约定，我们定义组件时完全可以将子节点的布局信息保存在任意地方，也可以保存非布局信息。但是，还是强烈建议大家遵循Flutter的规范，这样我们的代码会更容易被他人看懂，也会更容易维护。

## 布局边界（relayoutBoundary）
一个组件是否是 布局边界 的条件：（一个原则，四个场景）<br />一个原则：组件自身的大小变化不会影响父组件<br />四个场景：

   - 当前组件父组件的大小不依赖当前组件大小。这种情况下父组件在布局时会调用子组件布局函数时并会给子组件传递一个 parentUsesSize 参数，该参数为 false 时表示父组件的布局算法不会依赖子组件的大小。
   - 组件的大小只取决于父组件传递的约束，而不会依赖后代组件的大小。这样的话后代组件的大小变化就不会影响自身的大小了，这种情况组件的 sizedByParent 属性必须为 true。
   - 父组件传递给自身的约束是一个严格约束（固定宽高）。这种情况下即使自身的大小依赖后代元素，但也不会影响父组件。
   - 组件为根组件。Flutter 应用的根组件是 RenderView，它的默认大小是当前设备屏幕大小。
## parentUsesSize/sizedByParent
 parentUsesSize 主要用于父布局对子布局的约束，例如 parentUsesSize = true，表示我需要依赖我孩子的大小，才能确定我的大小。<br />sizedByParent 主要用于约束自己（自己也有孩子），例如 sizedByParent = true，表示我接收我父亲的约束，但我不依赖我孩子的大小。当 sizedByParent = true 时，确定当前组件大小的逻辑应抽离到 performResize() 中，这种情况下 performLayout 主要的任务便只有两个：对子组件进行布局和确定子组件在当前组件中的布局起始位置偏移。
## Constraints

1. 宽松约束：不限制最小宽高（为0），只限制最大宽高，可以通过 BoxConstraints.loose(Size size) 来快速创建。
2. 严格约束：限制为固定大小；即最小宽度等于最大宽度，最小高度等于最大高度，可以通过 BoxConstraints.tight(Size size) 来快速创建。
