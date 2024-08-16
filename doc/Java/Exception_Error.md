---
title: Exception 与 Error 关系
description: 什么是 Exception？什么是 Error？两者的关系？
head:
  - - meta
    - name: description
      content: 什么是 Exception？什么是 Error？两者的关系？
  - - meta
    - name: keywords
      content: Java、Exception、Error
---
# Exception 与 Error 关系
---
# Exception
- 可检查异常
在源代码中必须显式地进行捕获处理。
- 不doc
即运行时异常，通常可编码避免的逻辑错误。例如：NullPointerException、ArrayIndexOutOfBoundsException
# Error
绝大多数的 Error 都会导致程序处于非正常的、不可恢复状态，不便于也不需要捕获。例如：OutOfMemoryError
# Exception&Error关系图
<br>

![](/doc/Java/img/Exception_Error/exception与error类关系图.webp)

<br>

# ClassNotFoundException 与 NoClassDefFoundError 的区别

- **类型方面：** 
   - ClassNotFoundException 是异常，并且是运行时异常，不可捕获；
   - NoClassDefFoundError 是错误，是JVM内部的错误，也无法捕获。
- **产生的原因方面：**
   - ClassNotFoundException：出现该错误的场景为，通过 Class.forName、ClassLoader.loadClass 等方式动态加载类时，无法通过传入的类路径查找到类时抛出。或者，一个类已通过某类加载器加载到内存中了，此时另一个类加载器尝试动态加载该类。
   - NoClassDefFoundError：在 Java 虚拟机或 ClassLoader 实例试图在类的定义中加载（作为通常方法调用的一部分，或者是使用 new 来创建新的对象）时，却找不到类的定义（要查找的类在编译的时候是存在的，运行的时候却找不到了），抛出此异常。
