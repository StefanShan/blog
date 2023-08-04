---
title: IDEA 插件开发之Unified Abstract Syntax Tree (UAST 统一抽象语法树)
date: 2022/9/26 22:19:00
categories:
- IDEA 插件开发
tags:
- Intellij IDEA
- Android Studio
- IDEA插件开发

---

> ***本文翻译总结自官方文档 [UAST - Unified Abstract Syntax Tree](https://plugins.jetbrains.com/docs/intellij/uast.html))***

# UAST 是什么

UAST 是不同 JVM 语言的 PSI 上的抽象层级，提供了一个统一的 API，用于处理类和方法声明、文字值和控制流运算符等公共语言元素。通过 UAST 可实现在所有支持的 JVM语言上的统一功能。

# UAST 支持何种语言

- JAVA : 全部支持

- Kotlin: 全部支持

- Scala: 测试版，但全部支持

- Groovy: 仅支持声明，不支持方法体

<!-- more -->

# UAST 与 PSI 转换

## UAST 转 PSI

```java
//调用 UElement的sourcePsi()可获得原始语言的 PsiElement
UElement.sourcePsi();
```

UElement#sourcePsi() 得到的 PsiElement 大多用于获取文本范围，或者检查警告/断点标记放置的锚元素。因为一些 UElement 是虚拟的，并没有 sourcePsi()，或者一些 UElement 通过 sourcePsi() 可能与获取 UElement 的元素不同，所以不可指定PSI类。

## PSI 转 UAST

基于性能考虑，推荐转换时指定 UElement 类型

```java
//java
// PsiElement 转换为指定 UElement
UastContextKt.toUElement(element, UCallExpression.class);
// PsiElement 转换为不同的指定 UElement 之一
UastFacade.INSTANCE.convertElementWithParent(element, new Class[]{UInjectionHost.class, UReferenceExpression.class});
// PsiElement 转换为不同的指定 UElement。例如: Kotlin 中构造函数入参既是 UField 又是 UParameter，如果想同时转为这两种可调用如下方法：
UastFacade.INSTANCE.convertToAlternatives(element, new Class[]{UField.class, UParameter.class});


//kotlin
// PsiElement 拓展方法
PsiElement.toUElement()
```

# UAST Visitors

在 UAST 中没有统一的方式获取 UElement 的 childern，因此只有通过将 UAST 看做一棵树，调用 UElement#accept() 方法传入 UastVisitor 获取。但并不推荐使用。可以通过 PsiTree 来遍历，然后针对需要 PsiElement 转换为 UElement。

```kotlin
PsiTreeUtil.collectElements(psiFile){ture}.forEach{psiElement ->
    val uElement = psiElement.toUElement()
}
```

# UAST 注意事项

- ULiteralExpression 不能用于 strings

- 由于历史原因，一些 UElement 实现自 PsiElement。但强烈不推荐把 UElement 当做 PsiElement 使用。可以通过 UElement#sourcePsi 或 UElement#javaPsi 获得 PsiElement。

- UAST 提供了一种统一的方式来通过 UMethod、UField、UClass 等来表示 JVM 兼容的声明。但同时所有的JVM语言插件都实现了PsiMethod、PsiClass等来兼容Java。这些实现可以通过 UElement#javaPsi 属性获得。

- UAST 构建的结构树可能与原语言( PSI )构建的结构树有差异。
