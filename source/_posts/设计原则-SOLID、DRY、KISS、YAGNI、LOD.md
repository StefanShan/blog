---
title: 设计原则-SOLID、DRY、KISS、YAGNI、LOD
date: 2021/2/6 20:24:00
categories:
- 设计模式
tags:
- 设计模式
- 设计原则
---

# 1. SOLID原则

## 1.1 SRP(Single Responsibility Principle) 单一职责

### 1.1.1 定义：一个类或模块只负责完成一个功能。

理解：不要设计大而全的类，要设计粒度小、高性能单一的类。该原则的目的是为了实现代码高内聚、低耦合、提高代码复用性、可读性以及可维护性。

<!-- more -->

### 1.1.2 以下场景可能会出现类没有职责单一：

- 类中的代码行数、函数、属性是否过多。可以考虑对该类进行拆分；
- 类依赖的其他类过多，或者依赖类的其他类过多，不符合高内聚、低耦合的设计思想；
- 私有方法过多，可以考虑将私有方法独立到新类中，设置为 public 方法，提高代码复用性；
- 当发现类名比较难命名或类名笼统、冗长时，说明该类职责定义不够清晰；
- 类中大量方法集中操作某几个属性时，可以考虑将这几个属性和方法拆分出去；

补充：在保证单一职责时，要避免过分拆分，否则会降低内聚性，影响代码可维护性。

<!-- more -->

### 1.1.3 举例：

```kotlin
/**
* 如果下面的用户信息类仅在一个场景中使用，则没有什么问题；
* 如果后面用户的地址信息在其他模块中使用时，就可以将地址信息进行拆分。
* 以及各个属性的操作方法都要进行聚合到一个类中，提高代码的维护性。
*/
data class UserData(val userId:Long, 
                    val userName:String, 
                    val email:String,
                    val telephone:String,
                    val provinceOfAddress:String,
                    val cityOfAddress:String,
                    val regionOfAddress:String,
                    //.....其他属性
                   )
```

## 1.2 OCP(Open Closed Principle) 开闭原则

### 1.2.1 定义：(模块、类、方法)对拓展开放，对修改关闭。

理解：对于新功能尽量通过拓展已有代码而非修改的方式完成。

补充：在开发中不需要识别、预留所有拓展点，切勿过度设计。最合理的做法是，保证短期内、可确定的部分进行拓展设计。做常用的代码扩展性的方法：多态、依赖注入、基于接口开发，以及部分设计模式(装饰、策略、模板、责任链、状态等)

### 1.2.2 举例

```kotlin
/**
* 基于接口开发。对于外部调用者，内部逻辑是无感知的，方便后面进行逻辑拓展，例如国内更新逻辑后面可能会支持跳转指定应用商店、H5链接等。
*/
interface IUpgradeService{
  fun checkUpgrade(ctx:Activity)
}

abstract class BaseUpgradeService : IUpgradeService{
  override fun checkUpgrade(ctx:Activity){
    //网络请求
    //....
    //执行需要更新
    startUpgrade()
  }

  fun startUpgrade()
}

class CnUpgradeService : BaseUpgradeService{
  override fun startUpgrade(){
    //国内执行更新逻辑。例如应用内下载安装等
  }
}

class I18nUpgradeService : BaseUpgradeService{
  override fun startUpgrade(){
    //海外执行更新逻辑。例如跳转google play
  }
}

//实际执行Activity
class MainActivity : AppCompactActivity{
  override fun onCreate(savedInstanceState : Bundle){
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    //执行更新逻辑
    ServiceLoader.instance.load(IUpgradeService::class.java).checkUpgrade(this)
  }
}
```

## 1.3 LSP(Liskov Substitution Principle) 里氏替换

### 1.3.1 定义：子类对象能够替换程序中父类对象出现的任何地方，并保证原来程序的逻辑行为不变及正确性不被破坏。

理解：在代码中可以用子类来替换父类，和多态类似，区别在于“里氏替换原则”是子类不能违背父类的协议，如父类要实现的功能、入参、出参、异常情况等。

### 1.3.2 举例

```kotlin
/**
* 下面代码违反里氏替换原则。因为父类并没有对参数进行校验和抛异常，子类违背了父类的协议(入参判断、异常情况)。
*/
class UpgradeService{
  fun checkUpgrade(ctx: Activity, appId:Int, channelId:Int){
    //... 检查逻辑
  }
}

class CnUpgradeService : UpgradeService{
  override fun checkUpgrade(ctx: Activity, appId:Int, channelId:Int){
    if(appId == 0 || channelId == 0){
      throw Exception(...);
    }
    //...国内检测逻辑
  }
}
```

## 1.4 ISO(Interface Segregation Principle) 接口隔离

### 1.4.1 定义：客户端(接口调用者)不应该被强迫依赖它不需要的接口。

理解：与“单一职责”类似，区别在于“单一职责”针对的是模块、类、接口的设计，“接口隔离”一方面更侧重于接口的设计，另一方面思考的角度不同。

补充：这里的“接口”可以理解为：①一组API接口集合；②单个API接口或函数；③OOP中的接口概念

### 1.4.2 举例

- 一组API接口集合

```kotlin
/**
* 下面代码违背了接口隔离原则。
* 因为后期新增的删除接口，对外所有服务都可以调用，非常容易导致误操作场景。
* 在没有做鉴权时，建议将删除接口单独做一个接口服务，供特殊场景使用。
*/
interface UserService{
  fun register(userName:String, password:String):Boolean
  fun login(userName:String, password:String):Boolean

  //后期新增了删除用户信息的接口
  fun deleteUserById(userId:Long):Boolean
}
```

- 单个API接口或函数

```kotlin
enum class ComputeType{
    ADD,
    SUBTRACT, 
    MULTIPLY , 
    DIVIDE
}

/**
* 假设下面代码每一种计算方式都比较复杂，则违背了接口隔离原则。
* 如果逻辑复杂的情况下，建议将每种情况作为一个单独的接口或函数进行处理。
* 例如:
* fun dataAdd(){}
* fun dataSubtract(){}
*/
fun dataCompute(firstNum:Int, secondNum:Int, computeType:ComputeType): Int{
  retrun when(computeType){
    ComputeType.ADD -> //....
    //....
  }
}
```

- OOP中的接口概念

```kotlin
/**
* 尽量避免设计大而全的接口，大而全会导致强迫调用者依赖不必要的接口
* 例如下面接口，如果调用者只是想配置监控和更新，还必须空实现配置日志数据。推荐根据功能进行拆分。
*/
interface IConfig{
  //更新配置信息
  fun update()
  //配置日志输出
  fun outputLog():String
  //配置监控
  fun monitorConfig()
}
```

## 1.5 DIP(Dependency Inversion Principle) 依赖倒置/依赖反转

### 1.5.1 定义：高层模块不依赖低层模块，它们共同依赖同一个抽象，抽象不要依赖具体实现细节，具体实现细节依赖抽象。

理解：该原则用于指导框架层面的设计，调用者与被调用者没有直接依赖关系，而是通过一个抽象(规范)来建立关系，同时抽象(规范)不依赖具体的调用者和被调用者的实现细节，而调用者和被调用者需要依赖抽象(规范)。例如，暴露请求参数，由调用者来实现具体的请求，并将结果再返回。

### 1.5.2 控制反转(IOC)、依赖反转(DIP)、依赖注入(DI)的区别与联系

- 控制反转：提供一个可拓展的代码骨架，用来组装对象、管理整个执行流程。不是一种具体的实现技巧，而是一种设计思想，一般用于指导框架层面的设计，具体的方式有很多，例如依赖注入、模板模式等。

```kotlin
abstract class TestCase{
  fun run(){
    if(doTest()){
      println("Test success")
    }else{
      println("Test failed")
    }
  }

  abstract fun doTest():Boolean
}

class UserServiceTest: TestCase{
  override doTest():Boolean{
    //....控制逻辑
  }
}

fun main(){
  UserServiceTest().run()
}
```

- 依赖注入：不通过 new()方式在类内部创建依赖类对象，而是将依赖的类对象在外部创建好后，通过构造函数、函数参数等方式传递(或注入)给类使用。

```kotlin
//Notification类使用通过构造函数传入的类对象messageSender调用发送逻辑
class Notification(val messageSender: MessageSender){
  fun sendMessage(cellphone: String, message: String){
    messageSender.send(cellphone, message)
  }
}

interface MessageSender{
  fun send(cellphone: String, message: String)
}

class SmsSender: MessgeSender{
  override fun send(cellphone: String, message: String){
    //...短信通知逻辑
  }
}

class EmailSender: MessageSender{
  override fun send(cellphone: String, message: String){
    //...邮件通知逻辑
  }
}

fun main(){
  val messageSender = SmsSender()
  val notification = Notification(messageSender)
  notification.sendMessage("xxxxx","xxxxx")
}
```

- 依赖反转：高层模块(调用者)不要依赖底层模块(被调用者代码)。高层模块和底层模块赢通过抽象来互相依赖。除此之外，抽象不要依赖具体实现细节，具体实现细节依赖抽象。

```kotlin
//抽象层
interface ISendTypeConfig{
    fun httpRequest(params: String)
    fun socketRequest(params: String)
}
//底层模块逻辑
class SendTypeManager(private val config: ISendTypeConfig){
    fun sendMessage(sendByHttp:Boolean, params: String){
        if (sendByHttp){
            config.httpRequest(params)
            return
        }
        //使用socket进行消息发送
    }
}

//高层模块逻辑
class SendTypeConfig: ISendTypeConfig{
    override fun httpRequest(params: String) {
        //使用http请求
    }

    override fun socketRequest(params: String) {
        //使用socket请求
    }

}

fun main(){
    //这段代码属于[底层模块]逻辑。高层模块只需关注消息发送方式的具体实现，然后调用底层模块的发送消息即可，不会关注底层模块的具体实现。
    SendTypeManager(SendTypeConfig()).sendMessage(true, "这是一条http发送的消息")
}
```

# 2. DRY(Don't Repeat Yourself)原则

理解：不要开发重复代码，可以复用或提取公共代码，同时也要注意遵守“单一职责”和“接口隔离”原则。

提升代码复用性的方法：

- 减少代码耦合
- 满足单一职责原则
- 模块化
- 业务与非业务逻辑分离
- 通用代码下沉
- 继承、抽象、多态、封装
- 应用模板等设计模式

# 3. KISS(Keep It Simple And Stupid)原则

理解：尽量保证代码简洁，使用通用技术(同事都懂的技术)、不重复造轮子、不过度优化。

举例：对于某个数值的提取或者匹配判断，使用正则表达式可以使代码行数更少，看似更简单，但其实并不是所有同事都熟悉正则表达式，而且在编写正则规则时易出现bug，所以可以采用通用技术来实现。

# 4. YAGNI(You Aint't Gonna Need It)原则

理解：不去设计与开发当前功能用不到的代码，但并不意味着不考虑拓展性，可以预留好拓展点，后面需要时再开发。

举例：目前项目只对国内市场，未来将会面向国内海外同时使用。所以在开发中不需要提前编写海外部分代码，但是在国内海外有差异的逻辑上要预留好拓展点，方便后面对海外逻辑进行补充。

# 5. LOD(Law of Demeter)原则/迪米特法则

理解：不该有直接依赖关系的类之间，不要有依赖；有依赖关系的类之间，尽量只依赖必要的接口。

举例：

```java
/**
* NetworkTransporter 类负责底层网络通信，根据请求获取数据。
*
* 该类的入参类型为 HtmlRequest 对象，作为底层类，应保证通用性，而不是仅服务于下载HTML。所以违反了迪米特法则，依赖了不该有直接依赖的 HtmlRequest 类。
*/
public class NetworkTransporter {
    // 省略属性和其他方法...
    public Byte[] send(HtmlRequest htmlRequest) {
      //...
    }
}

public class HtmlDownloader {
  private NetworkTransporter transporter;//通过构造函数或IOC注入

  public Html downloadHtml(String url) {
    Byte[] rawHtml = transporter.send(new HtmlRequest(url));
    return new Html(rawHtml);
  }
}

/**
* Document 表示网页文档，后续的网页内容抽取、分词、索引都是以此为处理对象。
*
* 该类总有如下3个问题:
* 1. 构造函数中的 downloader.downloadHtml() 逻辑复杂，耗时长，不应该放到构造函数中，会影响代码的可测试性。
* 2. HtmlDownloader 对象在构造函数中通过 new 来创建，违反了基于接口而非实现编程的设计思想，也会影响到代码的可测试性。
* 3. 从业务含义上来讲，Document 网页文档没必要依赖 HtmlDownloader 类，违背了迪米特法则。
*/
public class Document {
  private Html html;
  private String url;

  public Document(String url) {
    this.url = url;
    HtmlDownloader downloader = new HtmlDownloader();
    this.html = downloader.downloadHtml(url);
  }
  //...
}
```

> 参考：
> 
> [设计模式之美-极客时间](http://gk.link/a/127K8)
