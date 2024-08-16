---
title: Java反射
description: Java 反射原理.
head:
  - - meta
    - name: description
      content: Java 反射原理
  - - meta
    - name: keywords
      content: Java、反射
---
# Java反射
---
# new 对象的过程

![](/doc/Java/img/Java%20反射/class文件加载过程.webp)
<br>

**拓展点：**

- 通过 Class.newInstance() 构造对象时，需要保证该类具有一个无参构造方法，否则会报 InstantiantionException。而通过 Constructor.newInstance() 构造对象则没有要求。
```java
//前提： Dog 类中只有一个有参构造方法

Class cls = Class.forName("com.test.Dog");
Dog dog = cls.newInstance(); //报 InstantiantionException 异常

Constructor cs = Dog.class.getConstructor(String.class);
Dog dog = (Dog)cs.newInstance("测试"); //执行没有问题
```
- 通过  newInstance() 时必须保证该类已经加载并已建立连接，即已被类加载器加载完毕，而直接通过 new 不需要。

# 反射
在 Class 类中有一个静态内部类 ReflectionData，内部持有 Field[] (字段类实例)、Method[] (方法类实例)、Constructor[] (构造器类实例)、Class<?>[] (接口类实例) 等信息。
## Field
![image.png](/doc/Java/img/Java%20反射/Java字段映射.webp)
## Method
![image.png](/doc/Java/img/Java%20反射/Java方法映射.webp)
## 反射过程
![](/doc/Java/img/Java%20反射/Java反射过程.webp)
# 反射API
![image.png](/doc/Java/img/Java%20反射/Java反射API.webp)

---

> 参考资料引用
> - [Java反射，究竟是怎么一回事](https://zhuanlan.zhihu.com/p/370149724)
