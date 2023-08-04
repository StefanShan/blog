---
title: 一款实现开发工具类搜集的IDE插件
date: 2022/8/12 10:58
categories:
- IDEA 插件开发
tags:
- Intellij IDEA
- Android Studio
- IDEA 插件

---

# 背景

随着代码量的不断增加，为了开发方便，提取出了各种工具类/方法，但由于没有查询方式，往往只能是谁加的谁知道用，而其他人由于不知道已有该工具类/方法，所以无脑又新建了一个。这就导致项目体积增大，并且可维护性大大降低。

举个例子，项目有单位的处理的工具方法(例如大于1000显示K()大写)，但其他人不知道又重新建了个方法，某天要求所有地方的单位都统一成k(小写)，只能挨个功能搜索看用的那个方法处理的，这就出现嘞无用功，而且还容易遗漏。

基于该背景考虑是否可以提供工具，支持收集和搜索工具类，于是诞生了该插件(CollectUtilTool)。

# 使用效果

![WX20220811-211059@2x.png](images/一款实现开发工具类搜集的IDE插件/1.webp)

<!-- more -->

# 使用方式

## 通过 Plugin Marketplace

> 该插件已上架 JetBrains Marketplace，仅支持 Android Studio 、Intellij IDEA 开发工具，并仅支持 Java、Kotlin 语言。

1. 可通过 `Preferences` -> `Plugins` -> `Marketplace` 搜索 `CollectUtilTool` 安装。

2. 在工具类或方法上面，添加 `@utilDesc` 关键词的注释。例如：
   
   ```
   // @utilDesc 工具类UtilClass
   object UtilClass {
   
      /**
       * @utilDesc test
       */
      fun test(){
   
      }
   }
   ```

## 下载源码

该插件源码地址：<https://github.com/StefanShan/CollectUtil>

可通过修改 UtilClassFileManager.kt 文件下内容，修改注释扫描标志词和扫描文件范围。

```kotlin
object UtilClassFileManager {

    /**
     * 注释扫描关键词。通过该关键词判断是否为标记的工具类/方法
     *
     * 用法：
     * // @utilDesc 测试工具类
     * class Test{}
     */
    private const val COMMENT_TAG = "@utilDesc"

    /**
     * 文件扫描范围。
     *
     * 用法：目前支持扫描 java、kotlin 文件
     */
    val supportLanguages = arrayListOf("java", "kt")
}
```

# 原理

## 扫描

### 方案

~~方案1：通过 Intellij IDEA API 实时监听当前光标内容，对添加指定规则标记的文件进行收集。~~

原因：实时监听对性能影响较大，并且收集过程中会对文件解析，对性能消耗会进一步增大，而工具类增删改操作并不频繁，<span data-word-id="405" class="abbreviate-word">ROI</span>太低。

~~方案2：hook <span data-word-id="1027" class="abbreviate-word">git</span>，在提交前扫描提交的文件，对标记的文件进行收集。~~

原因：git hook 只能执行脚本，无法对文件进行解析，并且会降低开发效率。

~~方案3：通过 <span data-word-id="36907350" class="abbreviate-word">APT</span>，在编译时扫描标记的类或方法。~~

原因：APT方式只能扫到类与方法，无法确定所在的module，在存在同方法名时无法进行区分。

方案4：通过 Intellij IDEA API 在打开项目时进行一次全项目扫描，对符合标准的文件进行解析，收集标记的类/方法。同时可通过 API 监听文件的修改，筛选对标记的文件进行二次扫描，更新收集的列表。

### 方案4具体实现：

1. 监听项目启动
   
   通过注册`ProjectManagerListener` 监听项目状态。当打开项目时，先读取永久存储，然后在解除"哑巴"模式后判断永久存储是否有数据，若没有则开启扫描。当项目关闭时，将最新数据永久存储。

2. 监听文件修改
   
   在监听到打开项目时，注册文件修改监听。当监听到文件修改时，则扫描该文件。注意，修改文件后 IDEA 不会立即将内容保存至文本，所以需要在点击显示查询界面时，手动触发将内容从内存保存至文本，此时才会触发文件修改监听。

3. 扫描
   
   (1) 先遍历 Module，然后遍历每个 Module 中的文件
   
   (2) 针对每个文件，获取该文件的 Psi 树，然后过滤每个节点，仅收集 PsiComment(注释) 类型，并且 PsiComment 中存在扫描关键词(@utilDesc)。
   
   (3) 遍历每个 PsiComment，获取注释内容，并获取该节点的上一层节点(父节点)，将该父节点转换为 UAST，用于判断注释内容是作用在方法上，还是类上。然后收集父节点的信息(真正的工具类/方法内容)。
   
   (4) 将收集到的内容进行封装，存储到 Map 中，其中 Key 为文件的名称
   
   (5) 当对文件修改时，又会触发(2)(3)(4)步骤，因为 Key 为文件名称，所以会直接覆盖原有数据。
   
   (6) 当文件中的标记注释全部删除时，(2)步骤在收集后为空列表，说明该文件已没有标记注释了，所以直接从 Map 中移除。

## 显示

1. 实现`ToolWindowFactory`接口，重写 createToolWindowContent() 方法，并进行注册
2. 在`createToolWindowContent()` 中判断方法返回的 toolWindow 是不是自己的(判断注册的 id 与返回的 id 是否相等)。若是自己的窗口，则注册窗口事件监听，在窗口打开时触发将内存数据保存至文本，并刷新列表内容。
3. 在`createToolWindowContent()` 中添加UI(该插件通过 Kotlin UI <span data-word-id="810" class="abbreviate-word">DSL</span> 实现，不推荐，写起来贼麻烦。可用 GUI Form)。当点击每个 Item 时调用 ` OpenFileDescriptor( project, virtualFile, offset).navigate()  `方法，打来对应文件，并将光标定位到对应工具类/方法的行上。
