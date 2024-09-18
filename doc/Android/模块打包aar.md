---
title: 模块aar化
description: 自定义 Gradle 插件，支持模块自动打包aar，以及源码与aar切换
head:
  - - meta
    - name: description
      content: 自定义 Gradle 插件，实现模块自动打包aar，以及源码与aar切换
  - - meta
    - name: keywords
      content: Android、Gradle、编译优化、aar、源码与aar切换
---
# 性能优化-编译优化之模块aar化
---
# 背景
在[前文](./Gradle编译优化)中提及了模块 aar 化可提升编译效率。正好最近看到[一篇文章(yechao-源码和AAR的依赖替换指南)](https://juejin.cn/post/7354940230301696009)描述了切换的实践过程，在文章最后提及了“灵活切换源码依赖和远端依赖”。让我想起在之前的公司中，也用到过源码与远端依赖的切换工具，其实现更加完善，具备 IDEA 插件来切换以及自动打包aar。<br>
现在离开公司，没法用现成的了，那么是否可以自己撸一套简版的呢？说干就干。
# 需求
- 支持切换源码与远程依赖
- 支持自动打包aar并发布
## 需求分析
**源码与远程依赖切换**<br>
既然是简版，切换的操作就先手动配置来实现吧。具体可参考[文章](https://juejin.cn/post/7354940230301696009)中提到的方案来实现，即通过两个配置文件来实现 + substitute。

**自动打包aar并发布**<br>
这里可拆分出两个问题：
1. 何时触发打包发布<br>
A: 触发时机，需要结合公司情况。这里想到的场景有两个：
    - 通过 github action 实现。在分支合并时，触发打包并发布
    - 在 git 代码提交前（即 pre-commit），触发打包并发布

2. 如何实现打包发布<br>
A: 实现打包发布很简单。检测到修改的模块后，执行打包并发布至 maven 即可。
## 方案
> 此处触发打包发布时机采用 pre-commit 时.<br>
> 整体思路如下：
> ![](./img/模块aar化/思路图.webp)

# 开发
## 自动打包与发布
### 获取模块与gav坐标映射关系
在项目根目录中读取一个 module_aar.json 文件，该文件是有当前自定义 Gradle Plugin 生成，内部存储了模块与gav坐标的映射关系。文件内容格式如下：
:::details module_aar.json 文件内容格式
```json
[
    {
        "module": "accountApi",
        "localPath": "account/api",
        "gav": "com.BuildAAR.module:accountApi:0.0.3"
    },
    {
        "module": "accountImpl",
        "localPath": "account/impl",
        "gav": "com.BuildAAR.module:accountImpl:0.0.3"
    }
]
```
:::
将读取的映射关系维护在 `ConfigJsonHolder` 中。
```kotlin
project.gradle.projectsEvaluated {
    //解析 module_aar.json 获取模块源码与aar的映射
    val moduleAARFile = File(rootProject.projectDir, "module_aar.json")
    if (!moduleAARFile.exists()) return@projectsEvaluated
    ConfigJsonHolder.instance.init(Gson().fromJson(moduleAARFile.readText(), object : TypeToken<List<ModuleAARConfig>>() {}.type))
    //...
}
```
### 获取被修改的模块
可通过 `git diff --cached --name-only` 指令，获取暂存区中修改的文件名称。然后将获取的修改文件名称传入自定义 Gradle Task，与模块名称进行映射，获取到哪些模块修改了。
```kotlin
open class FindModifiedModuleTask: DefaultTask() {
    @TaskAction
    fun findModifiedModule() {
        val moduleNames = project.subprojects.filter {
            it.plugins.hasPlugin("com.android.library")
        }
        val modifiedModule = if (modifyFile.isNullOrEmpty()){
            moduleNames.map { it.name }
        }else {
            modifyFile!!.split("\n").mapNotNull { path ->
                return@mapNotNull moduleNames.find {
                    path.contains(it.rootProject.projectDir.toPath().relativize(it.projectDir.toPath()).toString())
                }?.name
            }.toSet()
        }
    }
    //...
}
```
### 获取哪些模块需要升级
因为模块间存在依赖关系，所以当底层模块打包发布后，上层依赖也需要打包发布。例如: moduleA 依赖 moduleB，当 moduleB 发布改动并打包发布后，那对应 moduleA 中的依赖需要更新并重新打包发布。<br>
针对这个问题，需要2步操作：1. 获取模块间依赖关系;2. 根据依赖关系构建打包顺序。<br>
#### 获取模块间依赖关系
在自定义 Gradle Plugin 中，通过监听 `projectsEvaluated()` 可知项目所有模块都已评估完成，此时可获取所有模块的依赖关系。
```kotlin
project.gradle.projectsEvaluated {
    //...
    gradle.allprojects {
        val subProject = this
        if (subProject.name != rootProject.name) {
            subProject.configurations.all {
                //获取project方式依赖的关系
                if (subProject.plugins.hasPlugin("com.android.library") && name.contains("implementation") || name.contains("compileOnly")) {
                    dependencies.filter { dep -> dep.group == rootProject.name }.forEach { dep ->
                        //模块被依赖的模块集合。如: moduleA 依赖 moduleB，则 dependenciesMap 存储为 moduleB = [moduleA]
                        dependenciesMap[dep.name] = dependenciesMap.getOrDefault(dep.name, emptySet()) + subProject.name
                    }
                }
                //...
            }
        }
    }
}
```
#### 构建打包顺序
获取到模块间依赖关系后，形成有向无环图，然后利用拓扑排序 + 上一步获取的被修改模块，构建出打包发布顺序。
```kotlin
open class FindModifiedModuleTask: DefaultTask() {

    @Internal
    var modifyFile: String?=null

    @Internal
    lateinit var dependencyMap: Map<String, Set<String>>

    @TaskAction
    fun findModifiedModule() {
        //获取修改的模块
        val moduleNames = project.subprojects.filter {
            it.plugins.hasPlugin("com.android.library")
        }
        val modifiedModule = if (modifyFile.isNullOrEmpty()){
            moduleNames.map { it.name }
        }else {
            modifyFile!!.split("\n").mapNotNull { path ->
                return@mapNotNull moduleNames.find {
                    path.contains(it.rootProject.projectDir.toPath().relativize(it.projectDir.toPath()).toString())
                }?.name
            }.toSet()
        }
        //构建打包顺序
        val needBuildModule = mutableSetOf<String>()
        modifiedModule.forEach {
            needBuildModule.add(it)
            needBuildModule.addAll(dependencyMap[it] ?: emptyList())
        }
        val buildOder = LinkedList<String>()
        val inDegree = mutableMapOf<String, Int>()
        for (moduleName in needBuildModule) {
            inDegree.putIfAbsent(moduleName, 0)
            dependencyMap[moduleName]?.forEach {
                inDegree[it] = inDegree.getOrDefault(it, 0) + 1
            }
        }
        val queue = LinkedList<String>()
        inDegree.forEach {
            if (it.value == 0) {
                queue.add(it.key)
            }
        }
        while (queue.isNotEmpty()) {
            val moduleName = queue.pop()
            buildOder.add(moduleName)
            dependencyMap[moduleName]?.forEach {
                inDegree[it] = inDegree.getOrDefault(it, 0) - 1
                if (inDegree[it] == 0) {
                    queue.add(it)
                }
            }
        }
        //直接输出，给 pre-commit 脚本使用
        println("$buildOder")
    }
}
```
### 打包 aar
在获取到打包顺序后，开始循环执行打包、发布。<br>
打包操作没有什么特别的，直接执行 `:$module:assembleRelease` 指令即可。<br>
每个模块打包结束后，接着执行发布操作。
### 发布 aar
发布操作有两个问题需要处理：
1. 模块需要添加发布插件与配置
2. 发布需要基于之前的版本进行+1
#### 配置发布
既然已经做 Gradle Plugin 了，要是手动一个一个模块添加 maven-publish 插件岂不是很 low。我们可以直接在项目评估阶段注入即可。
```kotlin
project.gradle.afterProject {
    val subProject = this
    if (name != rootProject.name && plugins.hasPlugin("com.android.library")) {
        plugins.apply("maven-publish")
        //需要等到 components 就绪后才能注入 maven 发布配置
        components.whenObjectAdded {
            if (this.name != "release") return@whenObjectAdded
            extensions.configure<PublishingExtension> {
                publications {
                    create<MavenPublication>("releaseAar") {
                        groupId = applicationId
                        artifactId = this@afterProject.name
                        //这里只是占位
                        version = ConfigJsonHolder.instance.getConfig(subProject.name)?.gav?.split(":")?.lastOrNull()?: "0.0.1"
                        from(this@whenObjectAdded)
                    }
                }
                repositories {
                    mavenLocal()
                }
            }
        }
    }
}
```
#### 执行发布
此处不能简单的执行 `:$module:publish` 操作。在执行发布前需要将 version 基于之前的版本 +1，并且在发布完成后需要记录模块与 gav 坐标的映射关系，为后面本地源码与远端依赖切换做准备。
```kotlin
tasks.register("configMaven") {
    if (!subProject.hasProperty("module")) return@register
    val moduleName = subProject.property("module")?.toString() ?: return@register
    val moduleProject = subProject.allprojects.find { it.name == moduleName } ?: return@register
    val moduleConfig = ConfigJsonHolder.instance.getConfig(moduleName)
    //版本+1
    moduleProject.extensions.getByType(PublishingExtension::class.java).apply {
        (publications.getByName("releaseAar") as MavenPublication).let {
            it.version = incrementVersion(it.version)
        }
    }
    //发布aar
    finalizedBy(moduleProject.tasks.findByName("publishToMavenLocal"))
    //更新 ConfigHolder
    val mavenVersion = moduleProject.extensions.getByType(PublishingExtension::class.java).let {
        (it.publications.getByName("releaseAar") as MavenPublication).version
    }
    moduleProject.tasks.findByName("publishToMavenLocal")?.doLast {
        if (moduleConfig == null) {
            //新组件
            ConfigJsonHolder.instance.addModuleConfig(ModuleAARConfig(moduleName, moduleProject.rootProject.projectDir.toPath().relativize(moduleProject.projectDir.toPath()).toString(), "${applicationId}:${moduleName}:${mavenVersion}"))
        } else {
            //旧组件,更新版本号
            ConfigJsonHolder.instance.updateModuleConfig(moduleConfig.copy( gav = moduleConfig.gav.split(":").mapIndexed { index, s -> if (index == 2) mavenVersion else s }.joinToString(":")))
        }
    }
}
```
### 更新配置文件 
按照构建顺序对所有模块打包、发布完成后，最新的模块与gav坐标映射关系已经维护在 `ConfigJsonHolder` 中。最后一步就是将最新的映射关系刷新到配置文件中。
```kotlin

tasks.register("updateConfig") {
    doLast {
        //更新 module_aar.json
        if (ConfigJsonHolder.instance.getConfigList().isEmpty()) return@doLast
        val moduleAARFile = File(project.projectDir, "module_aar.json")
        if (!moduleAARFile.exists()) {
            moduleAARFile.createNewFile()
        }
        //将 ConfigHolder 转成 json 覆盖写入文件
        moduleAARFile.writeText(Gson().toJson(ConfigJsonHolder.instance.getConfigList()))
    }
}
```
## 源码与远程依赖切换
### 读取配置文件
在上面'自动打包与发布'一节中已经获取了模块与gav坐标的映射关系。在切换时，就需要另一个配置文件，即哪些模块需要切换成源码。这里我们将配置定义在 `local.properties` 文件中，配置在此的好处是仅对自己有效，不会影响其他团队成员开发。<br>
配置的关键字有两个 `allLocalModule` 和 `localModule`。当 `allLocalModule=true` 时，所有模块全部切换成源码模式；当 `allLocalModule=false & localModule=["$moduleName"]`，则将配置的模块切成源码模式，其他仍为远程依赖（即 gav 坐标）
```kotlin
project.gradle.projectsEvaluated {
    //用一个工具类来读取 local.properties 文件
    LocalPropertyUtil.load(rootProject.projectDir)
    if (LocalPropertyUtil.checkNotExists() || !LocalPropertyUtil.checkKey("allLocalModule", "localModule")) {
        //local.properties 不存在 or 没有配置allLocalModule 和 localModule => 全部切换成 aar
        ModuleManager.addNeedToGavModule(rootProject.allprojects.map { it.name }.filter { it != rootProject.name })
    } else if (LocalPropertyUtil.getProperty("allLocalModule") == "true") {
        //全部切换成 源码
        ModuleManager.addNeedToProjectModule(rootProject.allprojects.map { it.name }.filter { it != rootProject.name })
    } else {
        //获取配置的源码模块
        val localModules = if (!LocalPropertyUtil.checkKey("localModule")) emptyList() else
            Gson().fromJson<List<String>>(LocalPropertyUtil.getProperty("localModule"), object : TypeToken<List<String>>() {}.type)
        //遍历所有模块，将不在配置或白名单的模块进行分组
        rootProject.allprojects.map { it.name }.filter { it != rootProject.name }.partition { it !in excludeModules && it !in localModules}.let {
            ModuleManager.addNeedToGavModule(it.first)
            ModuleManager.addNeedToProjectModule(it.second)
        }
    }
}
```
### 执行切换
在上一步读取配置文件后，即可知道哪些模块需要切换成源码，哪些需要切换成 gav坐标依赖，这些模块都由 `ModuleManager` 来维护。那么下一步就是通过 `substitute` 进行替换即可。
```kotlin
project.gradle.projectsEvaluated {
    gradle.allprojects {
        val subProject = this
        if (subProject.name != rootProject.name) {
            subProject.configurations.all {
                //依赖替换
                resolutionStrategy.dependencySubstitution {
                    //源码 切换成 gav坐标依赖
                    ModuleManager.getAllGavModule().forEach { ConfigJsonHolder.instance.getConfig(it)?.gav?.let { gav ->
                            substitute(project(":$it")).using(module(gav))
                        }
                    }
                    //gav坐标依赖 切换成 源码
                    ModuleManager.getAllProjectModule().forEach {ConfigJsonHolder.instance.getConfig(it)?.gav?.let { gav ->
                            substitute(module(gav)).using(project(":$it"))
                        }
                    }
                }
            }
        }
    }
}
```
# 完整代码
[自动打包发布与aar切换](https://github.com/StefanShan/simple/tree/master/BuildAAR)
# 踩坑记录
**kotlin自定义Task编译报错** <br>
kotlin 中的类默认 final 修饰，在自定义 Gradle Task 时需要用 open 修饰，否则编译报错。
```
Could not create task of type 'MyTask'.
  > Class Settings_gradle.MyTask is final.
```
**`maven-publish`配置注入时机** <br>
`maven-publish` 插件的配置时机需要在模块评估完成前注入（即 projectEvaluated() 触发前），否则编译报错。
```
Failed to apply plugin class 'org.gradle.api.publish.plugins.PublishingPlugin'.
  > Cannot run Project.afterEvaluate(Action) when the project is already evaluated.
```
**`java-gradle-plugin` 插件与maven发布配置问题** <br>
在Gradle 6.4及以后，可直接引入 `java-gradle-plugin` 插件来替代之前的 `java` 等插件，此插件自动实现 maven标注、java插件、gradleApi依赖。<br>
在引入 `java-gradle-plugin` 和 `maven-publish` 插件实现发布操作时，正确的配置如下：
```kotlin
//插件配置
gradlePlugin{
    plugins {
        create("myPlugin") {
            id = "com.stefan.plugin" //plugin id
            implementationClass = "com.stefan.plugin.ModuleAarPlugin" // java-gradle-plugin 自动实现 META-INFO 配置
        }
    }
}
//发布配置
group = "com.stefan"
version = "1.0.0"
publishing {
    //此处不能配置 publications{}，否则 `java-gradle-plugin` 插件生成的 maven标注将失效。
    repositories {
        maven {
            url = uri(layout.buildDirectory.dir("maven-repo"))
        }
        mavenLocal()
    }
}
```
如果想自定义 artifactId，则需要配置两种。
但如果通过 plugin id (如: `plugins {
    id("com.stefan.plugin") version "1.0.0"
}`)方式引入，查找时仍用的 `java-gradle-plugin` 插件生成的 maven标注。
```kotlin
group = "com.stefan"
version = "1.0.0"
publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = group as String
            artifactId = "buildAAR"
            version = version as String
            from(components["java"])
        }
        // 生成插件标记的 publication
        withType<MavenPublication>().configureEach {
            if (name == "pluginMarkerMaven") {
                artifactId = "com.stefan.plugin.gradle.plugin"
            }
        }
    }
    repositories {
        maven {
            url = uri(layout.buildDirectory.dir("maven-repo"))
        }
        mavenLocal()
    }
}
```

# 推荐阅读
- [yechao的掘金专栏-Gradle基础到进阶](https://juejin.cn/column/7123935861976072199)
- [Gradle官方文档-开发Gradle插件](https://doc.qzxdp.cn/gradle/8.1.1/userguide/custom_plugins.html#sec:custom_plugins_standalone_project)