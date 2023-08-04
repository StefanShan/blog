---
title: IDEA 插件开发之plugin.xml配置说明
date: 2022/8/16 14:43:00
categories:
- IDEA 插件开发
tags:
- Intellij IDEA
- Android Studio
- IDEA插件开发

---

```xml
<!--[可选项]可指定插件主页，用于在商店插件页展示-->
<idea-plugin url="https://example.com/my-plugin-site">

  <!--[必选项]插件唯一标识符，应该是不与已有插件重名的全限定名称。在版本升级中不能被修改。-->
  <id>com.example.myplugin</id>

  <!--[必选项]插件名称。要简单概要，最好1-4个单次长度(20个字符以内)，最多不得超过60个字符-->
  <name>My Framework Support</name>

  <!--[必选项]插件版本-->
  <version>1.0.0</version>

  <!--[必选项]开发者或团队名称，用于在插件页进行展示。
  属性：
   - "url" (可选) - 指定开发者或团队主页
   - "email" (可选) - 置顶开发者或团队 email 地址
  -->
  <vendor
      url="https://plugins.jetbrains.com/my-company"
      email="contact@example.com">My Company</vendor>

  <!--[可选项]注意！该标签用于配置收费插件！不可用于免费插件！
    详细配置规则可参见：https://plugins.jetbrains.com/build-and-market
  -->
  <product-descriptor
      code="PMYPLUGIN"
      release-date="20210901"
      release-version="20211"
      optional="true"/>

  <!--[可选项(gradle创建的项目)]插件支持的最小和最大 IDE 版本-->
  <idea-version since-build="193" until-build="193.*"/>

  <!--[必选项]插件描述。简要介绍插件的功能与亮点。必须要有英文说明！
    支持简单的 HTML 元素，例如文本格式、段落和列表等。HTML 标签必须在 `<![CDATA[]]>` 标签内部。
    具体配置规则可参见：https://plugins.jetbrains.com/docs/marketplace/plugin-overview-page.html#plugin-description
  -->
  <description>
  <![CDATA[
    Provides support for <a href="https://example.com/my-framework">My
    Framework</a>.
    <p>Includes support for:
    <ul>
      <li>code completion</li>
      <li>references</li>
      <li>refactoring</li>
    </ul>
    </p>
  ]]>
  </description>

  <!--[必选项]插件最新版本功能或bufix简介。支持简单的 HTML 元素，HTML 标签必须在 `<![CDATA[]]>` 标签内部。-->
  <change-notes>Initial release of the plugin.</change-notes>

  <!--[必选项]产品和插件兼容性要求。具体配置可参见：https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html
  -->
  <depends>com.intellij.modules.platform</depends>
  <depends>com.example.third-party-plugin</depends>

  <!--[可选项]对其他插件的可选依赖。
    例如：如果已安装ID为"com.example.my-second-plugin"的插件，则"mysecondplugin.xml"(与 plugin.xml格式相同)的内容将被加载。-->
  <depends
      optional="true"
      config-file="mysecondplugin.xml">com.example.my-second-plugin</depends>

  <!--[可选项]资源包(/messages/MyPluginBundle.properties)用于扩展点中的“键”属性和隐式键，如 “action.[ActionID].text|description”-->
  <resource-bundle>messages.MyPluginBundle</resource-bundle>

  <!--[可选项]声明插件的拓展点。已注册拓展点的插件，其他插件可利用拓展点为该插件提供数据。
      更多信息可参考：https://plugins.jetbrains.com/docs/intellij/plugin-extension-points.html
  -->
  <extensionPoints>
    <extensionPoint
        name="testExtensionPoint"
        beanClass="com.example.impl.MyExtensionBean"/>
    <applicationService
        serviceImplementation="com.example.impl.MyApplicationService"/>
    <projectService
        serviceImplementation="com.example.impl.MyProjectService"/>
  </extensionPoints>

  <!--[可选项]注册应用级监听。更多信息可参见：https://plugins.jetbrains.com/docs/intellij/plugin-listeners.html#defining-application-level-listeners-->
  <applicationListeners>
    <listener
        class="com.example.impl.MyListener"
        topic="com.intellij.openapi.vfs.newvfs.BulkFileListener"/>
  </applicationListeners>

  <!--[可选项]注册项目级监听器。更多信息可参见：https://plugins.jetbrains.com/docs/intellij/plugin-listeners.html#defining-project-level-listeners-->
  <projectListeners>
    <listener
        class="com.example.impl.MyToolwindowListener"
        topic="com.intellij.openapi.wm.ex.ToolWindowManagerListener"/>
  </projectListeners>

  <!--[可选项]注册 Action。更多信息可参见：https://plugins.jetbrains.com/docs/intellij/basic-action-system.html-->
  <actions>
    <action
        id="VssIntegration.GarbageCollection"
        class="com.example.impl.CollectGarbage"
        text="Collect _Garbage"
        description="Run garbage collector">
      <keyboard-shortcut
          first-keystroke="control alt G"
          second-keystroke="C"
          keymap="$default"/>
    </action>
  </actions>

  <!--[可选项]自定义扩展声明。更多信息可参见：https://plugins.jetbrains.com/docs/intellij/plugin-extensions.html#declaring-extensions-->
  <extensions defaultExtensionNs="VssIntegration">
    <myExtensionPoint implementation="com.example.impl.MyExtensionImpl"/>
  </extensions>
</idea-plugin>
```
