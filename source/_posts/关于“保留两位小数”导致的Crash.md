---
title: 关于“保留两位小数”导致的Crash
date: 2020/7/24 20:03:00
categories:
- 踩坑记录/问题合集
tags: 
- Android
- Java
---
最近在日常版本开发中，QA 发现某一功能国内版本没有问题，但是海外版本必现 Crash。当时收到Bug记录时一脸懵逼，同一套代码怎么会国内没问题，海外版本却必现 Crash 呢。找 QA 打印了 Crash 日志如下：
```
07-22 21:20:33.409 16542 16542 E AndroidRuntime: FATAL EXCEPTION: main
07-22 21:20:33.409 16542 16542 E AndroidRuntime: Process: com.xxx.xxxoverseas, PID: 16542
07-22 21:20:33.409 16542 16542 E AndroidRuntime: java.lang.NumberFormatException: For input string: ",01"
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at sun.misc.FloatingDecimal.readJavaFormatString(FloatingDecimal.java:2043)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at sun.misc.FloatingDecimal.parseDouble(FloatingDecimal.java:110)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at java.lang.Double.parseDouble(Double.java:538)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at com.xxxxx.VoiceMessagePresenter$RecordVoiceListener.onAudioVolume(VoiceMessagePresenter.java:90)
....
```
<!-- more -->

代码如下：
```java
public class VoiceMessagePresenter {
    ...
    @Override public void onAudioVolume(double v) {
        State state = State.RECORD_VOLUME;
        state.setAudioVolume(Double.parseDouble(new DecimalFormat("#.00").format(v)));
        mMessageActivity.updateState(state);
    }
    ...
}
```
What ？！NumberFormatException？输入的是 ",01" ? 明明是 `double`类型的怎么可能会出现`","`的呢？
带着疑问询问了 QA 和“度娘”，原来 **“海外部分国家会将小数点转为逗号”**，例如这次是 QA 将系统语言改为了泰文导致了这个问题。
好的，知道了问题原因，解决下：
```java
public class VoiceMessagePresenter {
    ...
    @Override public void onAudioVolume(double v) {
        State state = State.RECORD_VOLUME;
        DecimalFormat decimalFormat = new DecimalFormat("#.00");
        DecimalFormatSymbols symbols = new DecimalFormatSymbols();
        symbols.setDecimalSeparator('.');
        decimalFormat.setDecimalFormatSymbols(symbols);
        state.setAudioVolume(Double.parseDouble(decimalFormat.format(v)));
        mMessageActivity.updateState(state);
    }
    ...
}
```
自信满满告诉 QA 问题解决了，结果没过几分钟就被打脸了... </br>
QA:"老哥，仍然 Crash 呀，你这靠谱吗？"</br>
什么鬼？！再看 Crash 日志：
```
07-22 21:20:33.409 16542 16542 E AndroidRuntime: FATAL EXCEPTION: main
07-22 21:20:33.409 16542 16542 E AndroidRuntime: Process: com.xxx.xxxoverseas, PID: 16542
07-22 21:20:33.409 16542 16542 E AndroidRuntime: java.lang.NumberFormatException: For input string: ".oo"
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at sun.misc.FloatingDecimal.readJavaFormatString(FloatingDecimal.java:2043)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at sun.misc.FloatingDecimal.parseDouble(FloatingDecimal.java:110)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at java.lang.Double.parseDouble(Double.java:538)
07-22 21:20:33.409 16542 16542 E AndroidRuntime: 	at com.xxxxx.VoiceMessagePresenter$RecordVoiceListener.onAudioVolume(VoiceMessagePresenter.java:90)
....
```
我擦，还是 NumberFormatException？！输入成了 ".oo"，这又是什么鬼？目测肯定还是多语言搞的鬼，既然好无头绪那就换种方案实现呗，总不能 block 测试进度不是。直接上粗暴的方式，不用 Java 提供的工具类了。
```java
public class VoiceMessagePresenter {
    ...
    @Override public void onAudioVolume(double v) {
        State state = State.RECORD_VOLUME;
        double volume = ((long) (v * 100)) / 100.0;
        state.setAudioVolume(volume);
        mMessageActivity.updateState(state);
    }
    ....
}
```
再次提测，等了几分钟，提心吊胆的问 QA 验证没问题了吗？</br> QA:"没问题了~老哥以后自测完了再提测好不好..." </br>
Emm... 既然验证没问题了，咱们再回头看看到底咋回事。用`DecimalFormat`来处理会有问题，但是用粗暴的方式实现却没有问题，这两种最后的结果有什么区别呢？让我们再换一种方式来测试下:
```java
public class VoiceMessagePresenter {
    ...
    @Override public void onAudioVolume(double v) {
        mMessageActivity.updateState(new BigDecimal(v).setScale(2,BigDecimal.ROUND_HALF_UP).doubleValue());
    }
    ....
}
```
自己模拟测试了下，噢~ 这种方式也没有问题，那么这是为什么呢？</br>
真相只有一个！</br>
`DecimalFormat`方式处理的结果是 **`String `**，而通过语言特性或 `BigDecimal` 来实现的结果直接就是 **`double`**！而问题又仅出现在海外版本，海外的版本 **`String`** 类型可是会被转换为当地语言的！其实最开始的“小数点被转为逗号”也是这个原因。

## 总结：
这次出现 NumberFormatException Crash 的根本问题在于：
> 通过 `DecimalFormat` 来保留两位小数，然后通过 `Double.parseDouble()`转为 `double` 类型。由于海外存在多语言切换，例如当前语言为泰文，`DecimalFormat`保留两位小数后生成的是 `String` ，会被转换为泰文，导致`Double.parseDouble()`格式化时报错。

## 拓展：
保留两位小数有如下方式：<br/>
1. 通过 **`BigDecimal`** 方式（国内海外通用）
```java
BigDecimal bg = new BigDecimal(numberValue);
double result = bg.setScale(2, BigDecimal.ROUND_HALF_UP).doubleValue();
```
2. 通过 **`语言特性`** 方式（国内海外通用）
```java
double result = ((long) (numberValue * 100)) / 100.0;
```
3. 通过 **`DecimalFormat`** 方式（海外需要注意多语言问题）
```java
DecimalFormat df = new DecimalFormat("#.00");
String result = df.format(numberValue);
```
4. 通过 **`String#format`** 方式（海外需要注意多语言问题）
```java
String result = String.format("%.2f", numberValue)
```
5. 通过 **`NumberFormat`** 方式（海外需要注意多语言问题）
```java
NumberFormat nf = NumberFormat.getNumberInstance();
nf.setMaximumFractionDigits(2);
String result = nf.format(numberValue);
```
