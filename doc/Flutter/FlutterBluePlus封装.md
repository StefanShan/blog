---
title: 手把手教你如何封装 flutter_blue_plus
head:
  - - meta
    - name: keywords
      content: Flutter、蓝牙、flutter_blue_plus、低功耗蓝牙、ble
---
# 手把手教你如何封装 flutter_blue_plus
---
# 背景
最近在用 Flutter 重写公司 App，其中涉及蓝牙相关功能，于是用到了 [flutter_blue_plus](https://pub.dev/packages/flutter_blue_plus)。考虑到可维护性，不能直接在项目中使用，所以对其进行了简单封装以及业务分层。

> Q: 为什么不能直接在项目中使用？  
A: 可以直接使用，但如果后期更换库或者该库不维护/删库了怎么办呢？再者耦合业务逻辑没法提取公共的，工作量也很大。总之不封装后期修改都是“牵一发而动全身”。  
Q: 这么出名的库，怎么可能不维护或者删库呢？  
A: 可以搜索一下 “开源下载工具Aria被迫删库跑路”。
>

# 思路
1. 做分层封装，粗略分为基础服务和业务服务。业务服务又可根据不同蓝牙通信协议再次拆分/分层。
2. 基础服务仅对 flutter_blue_plus 进行封装，将其 API 按照蓝牙交互逻辑进行合并（如，“是否开启蓝牙”和“开启扫描”合并成一个“开启扫描”方法）。
3. 所有服务都是面向接口开发，仅暴露可用方法，对外隐藏内部实现。

# 实战
## 基础服务
首先约定服务能力:

+ 开始扫描
+ 停止扫描
+ 开始连接
+ 断开连接
+ 蓝牙状态
+ 读写入数据

### 开启扫描
开启扫描涉及到蓝牙开关检测、扫描过滤、返回扫描结果。

![](/doc/Flutter/img/flutter_blue_plus/start_scan.webp)

+ 由于扫描是持续返回列表的过程，所以该方法返回 Stream，所以当内部判断不成立时，通过抛异常方式返回错误信息和中断执行。
+ 为了避免外层调用时引用到 flutter_blue_plus 库中的内容，所以返回的设备信息也需要进行封装，定义 BleDevice 暴露需要的信息（例如，设备名称、rssi值等）。

注意：

1. 蓝牙扫描状态的监听，默认是 false，所以用此监听来返回扫描状态时需要 `skip(1)` 略过。
2. iOS 扫描到的设备是没有 mac 的，即 remoteId 是空，所以`FlutterBluePlus.startScan(withRemoteIds)` 不推荐使用。
3. iOS 扫描设备时 remoteId 为空，那如何获取 mac ? 一般硬件嵌入式会在广播包中写入厂商ID，内部会写入设备的 mac。（即 `ScanResult.advertisementData.manufacturerData` 中可以解析到）

```dart
///开启扫描
/// @param timeout 超时时间，默认5s
/// @param filterByName 过滤名称(匹配任何子字符串）
/// @param filterByRssi 过滤rssi信号量
Stream<List<BleDevice>> startScan({Duration? timeout, List<String>? filterByName, int? filterByRssi}) {
  StreamController<List<BleDevice>> streamController = StreamController<List<BleDevice>>.broadcast();
  FlutterBluePlus.adapterState.listen((adapterState) async{
    if (adapterState == BluetoothAdapterState.off) {
      if (!Platform.isAndroid) {
        throw BleException(code: BleCode.notOpen, msg: "bluetooth switch not opened");
      }
      try {
        await FlutterBluePlus.turnOn();
      } catch (e) {
        throw BleException(code: BleCode.notOpen, msg: "bluetooth switch not opened");
      }
    }
    if (adapterState == BluetoothAdapterState.on) {
      FlutterBluePlus.isScanning.skip(1).listen((isScanning) {
        if (isScanning) {
          _streamController.add(BleState.scanning);
        } else {
          _streamController.add(BleState.stopScan);
        }
      });
      var subscription = FlutterBluePlus.onScanResults.where((event) => event.isNotEmpty).listen((scanResult) {
        var deviceList = <BleDevice>[];
        for (var value in scanResult.where((element) => element.device.advName.isNotEmpty && element.rssi.abs() < (filterByRssi ?? 1000))) {
          //返回 manufacturerData，用于调用者解析 mac
          var device = BleDevice(value.device.platformName, value.device.remoteId.str, value.advertisementData.manufacturerData, value.rssi.abs());
          deviceList.add(device);
          _scanDeviceMap[value.device.remoteId.str] = value.device;
        }
        streamController.add(deviceList);
      });
      FlutterBluePlus.cancelWhenScanComplete(subscription);
      FlutterBluePlus.startScan(withKeywords: filterByName ?? [], timeout: timeout ?? const Duration(seconds: 5));
    }
  });
  return streamController.stream;
}
```

### 停止扫描
```dart
  Future<void> stopScan() => FlutterBluePlus.stopScan();
```

### 开启连接
开启连接包含了连接 + 连接状态 + 发现服务。

![](/doc/Flutter/img/flutter_blue_plus/start_connect.webp)

+ 连接过程涉及硬件蓝牙服务、特征交互，与业务逻辑强关联，所以通过定义 ConnectConfig 由调用者实现并注入。

```dart
class ConnectConfig {
  final String serverUUID; //服务UUID
  final List<CharacteristicConfig> characteristicConfig;  //特征相关配置
}
class CharacteristicConfig {
  final String characteristicUUID; //特征UUID
  final bool notify; //是否开启通知
  final bool forWrite; //是否为写入特征（用于写入指令的特征）
  final Function(List<int> data) parseData; //远端蓝牙设置发送/返回数据的回调
}
```

+ 连接状态由自己封装的蓝牙状态实现，所以方法内的失败结果则通过抛异常的方式返回。

注意：

1. `BluetoothDevice.connect()` 默认超时时长 35s，超时后自动断开连接并抛异常，所以在 try-catch 时要对其进行过滤（并非失败）。
2. 蓝牙连接状态监听，在连接时会首先发送一次 disconnected 状态，需要对其进行过滤。

```dart
///连接
/// @param mac mac地址
/// @param config 连接配置
/// @param timeout 超时时间，默认20s
Future<void> startConnect({required String mac, required ConnectConfig config, Duration? timeout}) async {
  if (FlutterBluePlus.isScanningNow) {
    stopScan();
  }
  _streamController.add(BleState.connecting);
  Completer comparable = Completer();
  var device = _scanDeviceMap[mac] ?? BluetoothDevice.fromId(mac);
  var connectSubscription = device.connectionState.listen((event) async {
    if (event == BluetoothConnectionState.connected) {
      _currentConnectDevice = device;
      //发现服务
      try {
        await _findGattService(config);
        _streamController.add(BleState.connectSuccess);
        comparable.complete();
      } catch (e) {
        disConnect();
        _streamController.add(BleState.connectFail);
        comparable.completeError(e);
      }
    } else if (event == BluetoothConnectionState.disconnected) {
      //加判断原因是连接前会先触发一次 disconnected
      if (currentState != BleState.connecting){
        _streamController.add(BleState.disconnect);
      }
      if (_currentConnectDevice != null) {
        _currentConnectDevice = null;
      }
    }
  }, onError: (e) {
    disConnect();
    _streamController.add(BleState.connectFail);
    comparable.completeError(e);
  });
  device.cancelWhenDisconnected(connectSubscription, next: true, delayed: true);
  try {
    await device.connect(timeout: timeout ?? const Duration(seconds: 20));
  } catch (e) {
    if ((e as FlutterBluePlusException).code == FbpErrorCode.connectionCanceled.index) {
      return;
    }
    _streamController.add(BleState.connectFail);
    comparable.completeError(BleException(code: BleCode.connectFail, msg: "connect failed"));
    return;
  }
  return comparable.future;
}

Future<void> _findGattService(ConnectConfig config) async {
  var list = await _currentConnectDevice!.discoverServices();
  var service = list.firstWhere((element) => element.serviceUuid.toString() == config.serverUUID);
  for (final characteristicConfig in config.characteristicConfig) {
    var characteristic = service.characteristics.firstWhere((element) => element.characteristicUuid.toString() == characteristicConfig.characteristicUUID);
    if (characteristicConfig.notify && !await characteristic.setNotifyValue(true)) {
      throw BleException(code: BleCode.characteristicNotifyFail, msg: "${characteristicConfig.characteristicUUID} notfiy is open failed");
    }
    if (characteristicConfig.forWrite) {
      _writeCharacteristic = characteristic;
    }
    characteristic.onValueReceived.listen((data) {
      characteristicConfig.parseData(data);
    });
  }
}
```

### 断开连接
```dart
Future<void> disConnect() async {
  await _currentConnectDevice?.disconnect(queue: false);
  _currentConnectDevice = null;
}
```

### 写入数据
+ 写入数据的特征是在调用 `startConnect()` 时由外部传入的标识 `forWrite` 标记的特征。
+ 写入数据格式为数组，具体类型则有外部调用决定。例如，外部将一个指令进行位运算+进制转换等。

```dart
Future<void>? writeData(List<int> data, {int timeout = 15}) {
  if (_writeCharacteristic == null) {
    throw BleException(code: BleCode.writeFail, msg: "not find write characteristic");
  }
  return _writeCharacteristic!.write(data, withoutResponse: true, timeout: timeout);
}
```

## 业务服务
业务服务主要封装了蓝牙通信协议逻辑。考虑到项目中可能采用不同通信协议，所以要对其进行分层封装，便于新增或修改。

> 此处的蓝牙通信协议是指不同设备嵌入式约定的不同指令集。如，设备 A 约定通信指令 0x0103 是获取设备信息，设备 B 约定通信指令 0x0103 是获取设备用户配置。
>

分层和封装思路如下：

+ DeviceService (设备服务)：上层业务（UI 交互逻辑）调用的唯一入口，包含了所有设备相关操作，如：扫描、连接、绑定（业务逻辑绑定，非蓝牙通信）和获取设备信息等蓝牙指令。

```dart
class _DeviceServiceImpl implements DeviceService {
  ///....
  Stream<List<Device>> startScan({List<DeviceScanType>? matchName, int? timeout, int? filterByRssi}) async* {
    yield* BleService()
        .startScan(
            filterByName: (matchName ?? DeviceScanType.values).map((e) => e.matchName).toList(),
            filterByRssi: filterByRssi ?? 90,
            timeout: Duration(seconds: timeout ?? 15))
        .asyncMap((event) {
          event.removeWhere((element) => !element.manufacturerData.containsKey(30736));
          return event.map((value) {
            var deviceMac = value.remoteId;
            try {
              // iOS 扫描中无法获取 mac，从设备制造商ID中解析出 mac
              if (Platform.isIOS) {
                var manufacturerData = value.manufacturerData[30736]!;
                deviceMac = "";
                for (int i = manufacturerData.length - 6; i < manufacturerData.length; i++) {
                  deviceMac += "${manufacturerData[i].toRadixString(16).padLeft(2, '0')}:";
                }
                deviceMac = deviceMac.substring(0, deviceMac.length - 1);
              }
            } catch (ignore) {}
            return Device(value.name, "${value.name}/$deviceMac", deviceMac, value.rssi, value.remoteId);
          }).toList()
            ..sort((a, b) => a.rssi - b.rssi);
    });
  }

  // _currentStrategy 在设备连接成功后，根据自己的业务逻辑进行判断应该使用哪个设备能力
  Future<int?> getTimeMode() async =>  _currentStrategy?.getTimeMode();
}
```

+ Strategy (设备能力)：封装各种/各代设备的蓝牙指令。如：Strategy_One，表示一代设备支持的蓝牙操作。

```dart
abstract class IBleStrategy {
  //获取时间制式 0: 24小时制; 1:12小时制
  Future<int> getTimeMode() async => throw UnsupportedError("not support");
}

class ThreeStrategy extends IBleStrategy {
  Future<int> getTimeMode() async {
    // 此处 DeviceCommandWithGet 是 Scheme 的封装
    var config = await DeviceCommandWithGet().getDeviceConfig();
    return config.isEmpty? 0 :config["timeUnit"] ?? 0;
  }
}

class FourStrategy extends IBleStrategy {}
```

+ Scheme (通信协议)：实现和管理各通信协议指令集。如：蓝牙通信协议使用 UZ 方案，约定通信时按 16 进制写入指令，前两位是指令，后十位是数据，最后四位为 crc。

```dart
abstract class UZBleScheme {

  //实现具体通信协议
  static Future<void> _sendCMD(SendCMDInfo cmdInfo) async {
    int cmd = cmdInfo.cmd;
    List<int> data = cmdInfo.data;
    int dataLength = data.length + 6;
    List<int> cmdValue = Int64List(dataLength);
    int offset = 0;
    cmdValue[offset++] = (cmd >> 8) & 0xff;
    cmdValue[offset++] = cmd & 0xff;
    cmdValue[offset++] = dataLength & 0xff;
    cmdValue[offset++] = (dataLength >> 8) & 0xff;
    List.copyRange(cmdValue, offset, data, 0, dataLength - 6);
    //...
    return BleService().writeData(cmdValue);
  }

  ///....
}
```

+ Handler (蓝牙指令)：封装各通信协议的蓝牙指令。如：UZ 方法中约定获取设备信息需要指令两条指令，则提供一个方法，内部实现两条指令逻辑。

```dart
class DeviceCommandWithGet {
  ///....
  Future<BleDeviceInfo> getDeviceInfo() async {
    //假定需要两条指令
    YCBle.sendCMD(SendCMDInfo(CMD.getDeviceInfo, [0x47, 0x43]));
    YCBle.sendCMD(SendCMDInfo(CMD.getDeviceInfo, [0x42, 0x41]));
    try{
      //监听设备返回信息，并按照通信协议约定进行解析
      var resp = await YCBle.bleRespStream.firstWhere((element) => element.cmdType == CMDType.get && element.cmdKey == GetCMDKey.deviceInfo);
      return unPackDeviceInfoData(resp.data);
    }catch(e){
      return BleDeviceInfo(0,"0",0);
    }
  }
}
```
## 总结
基础服务与业务服务（内部分层）之间的关系如下：
![](/doc/Flutter/img/flutter_blue_plus/summary.webp)

