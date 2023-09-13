---
title: Tinker Patch 包生效原理 - Dex
date: 2023/08/23
categories:
- [Android]
- [Tinker]
- [源码解读]
tags:
- Tinker
---

> **声明：源码基于 Tinker SDK 1.9.14.21 版本。**
> 本篇按照先使用，再了解原理的顺序来讲解，最后总结整个流程。（不关心中间过程，可以直接调至总结）

## 使用
按照官方文档，我们先实现 Tinker 初始化和 Patch 下载后的调用
```java
//Tinker 初始化
val tinker: Tinker = Tinker.Builder(applicationLike.application)
            .tinkerFlags(applicationLike.tinkerFlags)
            .patchReporter(CustomPatchReporter(applicationLike.application))
            .tinkerLoadVerifyFlag(applicationLike.tinkerLoadVerifyFlag)
            .build()
Tinker.create(tinker)
tinker.install(applicationLike.tinkerResultIntent)

// 下载后调用
Tinker.with(context).patchListener.onPatchReceived("$tinkerPath/${fileName}.apk")
```
 根据调用顺序，Tinker 初始化位于 Application 生命周期中，而 Tinker Patch 生效调用位于下载回调，理论上按照 初始化 -> Patch 生效调用 的顺序讲解源码，但实际顺序是：初始化 ->  Patch 生效调用 -> Application 执行(下次启动) 的顺序来讲解。

<!-- more -->

## 原理
### Tinker 初始化
Tinker 初始化主要逻辑有三点：build、create、install，其中 build 和 create 可以合并来看。下面依次来看：
#### Tinker.Builder&Create
```java
public class Tinker {

    //注入一个Tinker 单例。
    private static Tinker sInstance;
    public static void create(Tinker tinker) {
        if (sInstance != null) {
            throw new TinkerRuntimeException("Tinker instance is already set.");
        }
        sInstance = tinker;
    }

    //Tinker 的构造类，可以做一些配置。
    public static class Builder {
        private final Context context;
        private final boolean mainProcess;
        private final boolean patchProcess;

        private int status = -1;
        private LoadReporter  loadReporter;
        private PatchReporter patchReporter;
        private PatchListener listener;
        private File          patchDirectory;
        private File          patchInfoFile;
        private File          patchInfoLockFile;
        private Boolean       tinkerLoadVerifyFlag;
        //....
    }
}
```
上面代码逻辑很简单，通过 Builder 模式（建造者模式）让调用者自行配置构造出 Tinker 对象，然后调用 create() 方法将其传入 Tinker 中，后面 Tinker 的内部逻辑都会使用该单例。
#### Tinker.install
```java
public class Tinker {
    
    public void install(Intent intentResult) {
        install(intentResult, DefaultTinkerResultService.class, new UpgradePatch());
    }

    public void install(Intent intentResult, Class<? extends AbstractResultService> serviceClass,
                        AbstractPatch upgradePatch) {
        
        TinkerPatchService.setPatchProcessor(upgradePatch, serviceClass);
    	//...
    }
}
```
这里出现了几个重要信息，三个参数和一个方法调用：

- **intentResult**：这个入参通过示例 (applicationLike.tinkerResultIntent) 可知，是由 ApplicationLike 持有的 Intent 对象。具体如何生成的，下面会细说。
- **DefaultTinkerResultService** ( extends AbstractResultService)：Tinker 热修复结果处理 Service，当热修复结束后会启动并调用该 Service。这里使用默认的 Service ，其内部实现为热修复成功直接杀死进程。
- **UpgradePatch**：这个重点类！内部实现了 patch 的合并逻辑。先按下不表，后面讲解 "Patch 生效调用" 时会细讲。
- **TinkerPatchService.setPatchProcessor()**：该方法将 UpgradePatch 和 DefaultTinkerResultService 对象传入，并预加载了 DefaultTinkerResultService 类，没有其他逻辑。这里也是为后面 "Patch 生效调用" 做准备。
### Tinker Patch 生效调用（patch  的处理）
```java
// 示例
Tinker.with(context).patchListener.onPatchReceived("$tinkerPath/${fileName}.apk")
```
示例中通过调用 PatchListener#onPatchReceived() 方法并传入下载的 patch 包实现 patch 包的加载。
> 那么 PatchListener 是什么呢？
> 这个对象是在 Tinker.Build 中创建的，我们没有传入，则使用的就是 DefaultPatchListener。

#### DefaultPatchListener#onPatchReceived()
那下面就看下 DefaultPatchListener 的 onPatchReceived() 是如何实现的。
```java
public class DefaultPatchListener implements PatchListener {
    
    public int onPatchReceived(String path) {
        //获取 patch
        final File patchFile = new File(path);
        //获取 patch MD5
        final String patchMD5 = SharePatchFileUtil.getMD5(patchFile);
        //校验 patch
        final int returnCode = patchCheck(path, patchMD5);
        if (returnCode == ShareConstants.ERROR_PATCH_OK) {
            //启动守护 Service
            runForgService();
            //开始处理 patch
            TinkerPatchService.runPatchService(context, path);
        } else {
            Tinker.with(context).getLoadReporter().onLoadPatchListenerReceiveFail(new File(path), returnCode);
        }
        return returnCode;
    }
}
```
 代码逻辑很简单，获取 patch 并校验，然后调用 TinkerPatchService.runPatchService() 开始处理。
```java
public class TinkerPatchService extends IntentService {
    
    public static void runPatchService(final Context context, final String path) {

        Intent intent = new Intent(context, TinkerPatchService.class);
        intent.putExtra(PATCH_PATH_EXTRA, path);
        intent.putExtra(RESULT_CLASS_EXTRA, resultServiceClass.getName());
        try {
            context.startService(intent);
        } catch (Throwable thr) {
            ShareTinkerLog.e(TAG, "run patch service fail, exception:" + thr);
        }
    }
}
```
TinkerPatchService.runPatchService() 会启动 TinkerPatchService（该 Service 执行在 :patch 进程中），并传入 patch 路径和 resultServiceClassName。
> resultServiceClassName 是什么呢？
> 其实就是在 [Tinker.install](#S4Qe7) 中传入的 **DefaultTinkerResultService**。

#### patch 的处理 - TinkerPatchService#doApplyPatch()
启动了 TinkerPatchService（extends IntentService)，那么直接看它的 onHandleIntent() 逻辑。
```java
public class TinkerPatchService extends IntentService {
    
    @Override
    protected void onHandleIntent(Intent intent) {
        doApplyPatch(this, intent);
    }

    private static void doApplyPatch(Context context, Intent intent) {

        //标记正在运行中。内部逻辑是通过创建一个文件来实现，即 mark 创建文件， unMark 则删除文件。
        //注意：该方法会创建出 tinker 目录(data/user/0/{packageName}/tinker)，该目录在后面也会使用。
        markRunning(context);

        //获取 patch 文件
        String path = getPatchPathExtra(intent);
        File patchFile = new File(path);
        
        boolean result;
        PatchResult patchResult = new PatchResult();

        //真正处理 patch
        result = upgradePatchProcessor.tryPatch(context, path, patchResult);
        
        patchResult.isSuccess = result;
        patchResult.rawPatchFilePath = path;

        //启动 DefaultTinkerResultService，并将热修复结果告知
        AbstractResultService.runResultService(context, patchResult, getPatchResultExtra(intent));
    }
}
```
为了方便查看，对源码进行部分删减，并添加了代码注释。通过调用 markRunning() 标记正在运行，并创建 tinker 目录（该目录在后面也会使用）。然后调用 upgradePatchProcessor.tryPatch() 开始处理 patch。
> upgradePatchProcessor.tryPatch 是什么呢？
> 其实它就是在 Tinker.install 中传入的 **UpgradePatch。**

#### patch 的处理 - UpgradePatch#tryPatch()
```java
public class UpgradePatch extends AbstractPatch {
    
    @Override
    public boolean tryPatch(Context context, String tempPatchPath, PatchResult patchResult) {
        Tinker manager = Tinker.with(context);

        final File patchFile = new File(tempPatchPath);

        //创建该对象时会获取原 apk 的 md5
        ShareSecurityCheck signatureCheck = new ShareSecurityCheck(context);
    	//校验 patch 和原 apk 的签名、tinkerId、tinkerFlags
        int returnCode = ShareTinkerInternals.checkTinkerPackage(context, manager.getTinkerFlags(), patchFile, signatureCheck);

        String patchMd5 = SharePatchFileUtil.getMD5(patchFile);

        // 默认为 /data/user/0/{packageName}/tinker/
        final String patchDirectory = manager.getPatchDirectory().getAbsolutePath();

        //获取 info.lock 文件（文件锁）
        File patchInfoLockFile = SharePatchFileUtil.getPatchInfoLockFile(patchDirectory);
        //获取 patch.info 文件
        File patchInfoFile = SharePatchFileUtil.getPatchInfoFile(patchDirectory);

        //解析 patch 包中的 package.mate 文件信息（内容为：tinkerId,newTinkerId,isProtectedApp)
        final Map<String, String> pkgProps = signatureCheck.getPackagePropertiesIfPresent();

        //获取是为加固 app 的 patch
        final String isProtectedAppStr = pkgProps.get(ShareConstants.PKGMETA_KEY_IS_PROTECTED_APP);
        final boolean isProtectedApp = (isProtectedAppStr != null && !isProtectedAppStr.isEmpty() && !"0".equals(isProtectedAppStr));

        //解析 patch.info 文件
        SharePatchInfo oldInfo = SharePatchInfo.readAndCheckPropertyWithLock(patchInfoFile, patchInfoLockFile);

        SharePatchInfo newInfo;
        
        if (oldInfo != null) {
            //由于我们按照同一个 patch 仅下发一次的条件来讲解，所以这里 oldInfo 为空。这部分逻辑直接忽略。
            //....
        } else {
            newInfo = new SharePatchInfo("", patchMd5, isProtectedApp, false, Build.FINGERPRINT, ShareConstants.DEFAULT_DEX_OPTIMIZE_PATH, false);
        }

        //裁剪 patch MD5 的前八位字符，作为 patch name
        // 例如：
        //   patch MD5 = bd38ab8e81d66976411eae3e4b871b67
        //   patch name = bd38ab8e
        final String patchName = SharePatchFileUtil.getPatchVersionDirectory(patchMd5);

        //路径：/data/user/0/{packageName}/thinker/{patchName}/
        final String patchVersionDirectory = patchDirectory + "/" + patchName;

        //新文件 -> /data/user/0/{packageName}/thinker/{patchName}/{patchName}.apk
        File destPatchFile = new File(patchVersionDirectory + "/" + SharePatchFileUtil.getPatchVersionFile(patchMd5));

        try {
            //将 patch copy 到 /data/user/0/{packageName}/thinker/{patchName}/{patchName}.apk 中。
            // 原因：原 patch 可能在热修复过程中被删除。
            if (!patchMd5.equals(SharePatchFileUtil.getMD5(destPatchFile))) {
                SharePatchFileUtil.copyFileUsingStream(patchFile, destPatchFile);
            }
        } catch (IOException e) {return false;}

        //使用 copy 后的 {patchName}.apk 进行后续处理。
        if (!DexDiffPatchInternal.tryRecoverDexFiles(manager, signatureCheck, context, patchVersionDirectory, destPatchFile, patchResult)) {
            return false;
        }

        //后面是 鸿蒙、resource、so 等处理。我们这里只关注 Android 原生 dex 的处理逻辑，所以这里省略。
        //....


        //写入 patch.info 和 info.lock
        if (!SharePatchInfo.rewritePatchInfoFileWithLock(patchInfoFile, newInfo, patchInfoLockFile)) {
            return false;
        }
        
        return true;
    }
}
```
UpgradePatch#tryPatch() 包含了所有 patch (dex、source、 so) 的处理逻辑，所以会看起来会很多，这里我们只关注 Android Dex 的处理。简单梳理下逻辑：

1. 检验 patch
2. 解析 patch.info 文件
3. 截取 patch MD5，在 tinker 目录下创建新目录
4. 将原 patch copy 到新目录中，并重新命名（与目录同名）
5. 处理 copy 后新命名的 patch
#### patch 的处理 - DexDiffPatchInternal#tryRecoverDexFiles()
下面我们看下 patch 真正的处理逻辑： 
```java
public class DexDiffPatchInternal extends BasePatchInternal {
    
    protected static boolean tryRecoverDexFiles(Tinker manager, ShareSecurityCheck checker, Context context,
                                                String patchVersionDirectory, File patchFile, PatchResult patchResult) {

        //在前面校验 patch 时(ShareTinkerInternals.checkTinkerPackage)，读取了所有 mate.txt 结尾的文件，包含其 dex_mate.txt
        // dex_mate.txt 包含了 所有 patch dex 的信息。例如：
        //  test.dex,,56900442eb5b7e1de45449d0685e6e00,56900442eb5b7e1de45449d0685e6e00,0,0,0,jar
        String dexMeta = checker.getMetaContentMap().get(DEX_META_FILE);
    	
        boolean result = patchDexExtractViaDexDiff(context, patchVersionDirectory, dexMeta, patchFile, patchResult);
        return result;
    }
    
    private static boolean patchDexExtractViaDexDiff(Context context, String patchVersionDirectory, String meta, final File patchFile, PatchResult patchResult) {
        //目录：/data/user/0/{packageName}/thinker/{patchName}/odex/
        String dir = patchVersionDirectory + "/" + DEX_PATH + "/";

        //解压 patch，单个处理其 dex 文件，最终产出一个包含所有 dex 的新 apk
        if (!extractDexDiffInternals(context, dir, meta, patchFile, TYPE_DEX)) {
            return false;
        }
    	//这里 dexFiles 其实 只有一个 File，就是包含所有 dex 的新 apk
        File dexFiles = new File(dir);
        File[] files = dexFiles.listFiles();
        List<File> legalFiles = new ArrayList<>();
        if (files != null) {
            for (File file : files) {
                final String fileName = file.getName();
                // may have directory in android o
                if (file.isFile()
                    &&  (fileName.endsWith(ShareConstants.DEX_SUFFIX)
                      || fileName.endsWith(ShareConstants.JAR_SUFFIX)
                      || fileName.endsWith(ShareConstants.PATCH_SUFFIX))
                ) {
                    legalFiles.add(file);
                }
            }
        }

        //对新 apk 执行 dex 加载优化（dex2oat）
        final String optimizeDexDirectory = patchVersionDirectory + "/" + DEX_OPTIMIZE_PATH + "/";
        return dexOptimizeDexFiles(context, legalFiles, optimizeDexDirectory, patchFile, patchResult);

    }
}
```
通过源码可知，这里主要有两大部分：patch dex 处理；dex 优化。限于篇幅，下面只讲解 patch dex 处理部分，关于 dex 具体的合并，以及 dex 优化后面会单独写两篇。
```java
public class DexDiffPatchInternal extends BasePatchInternal {
    
    private static boolean extractDexDiffInternals(Context context, String dir, String meta, File patchFile, int type) {
        //解析 dex_mate.txt 文本信息。
        // 格式如下：
        //  classes.dex,,1a709bcb6cf8b50b12aa1deb7d6d5ba9,1a709bcb6cf8b50b12aa1deb7d6d5ba9,d947894c11a8be19ccba907934dcc87e,3658825026,1878190417,jar
        //   name     path          DVM MD5							ART MD5                           diffMd5                oldDexCrc  newDexCrc dexMode
        patchList.clear();
        ShareDexDiffPatchInfo.parseDexDiffPatchInfo(meta, patchList);

        //路径：/data/user/0/{packageName}/tinker/{patchName}/dex/
        File directory = new File(dir);
        if (!directory.exists()) {
            directory.mkdirs();
        }
        
        Tinker manager = Tinker.with(context);
        ZipFile apk = null;
        ZipFile patch = null;
        try {
            ApplicationInfo applicationInfo = context.getApplicationInfo();
            String apkPath = applicationInfo.sourceDir;
            apk = new ZipFile(apkPath);
            patch = new ZipFile(patchFile);
            //读取 patch 中的 dex (test.dex、classes.dex 等）放入 classNDexInfo 中 	
            if (checkClassNDexFiles(dir)) {
                return true;
            }
            for (ShareDexDiffPatchInfo info : patchList) {

                final String infoPath = info.path;
                String patchRealPath;
                if (infoPath.equals("")) {
                    patchRealPath = info.rawName;
                } else {
                    patchRealPath = info.path + "/" + info.rawName;
                }

                String dexDiffMd5 = info.dexDiffMd5;
                String oldDexCrc = info.oldDexCrC;

                //判断是 ART 还是 DVM，决定使用不同的 MD5
                String extractedFileMd5 = isVmArt ? info.destMd5InArt : info.destMd5InDvm;

                //根据 dex 名称创建不同的文件
                File extractedFile = new File(dir + info.realName);
                extractedFile.getParentFile().mkdirs();

                //读取 patch 和 原 apk 的 dex。例如 classes.dex
                ZipEntry patchFileEntry = patch.getEntry(patchRealPath);
                ZipEntry rawApkFileEntry = apk.getEntry(patchRealPath);

                //....

                //patch dex 和 原 apk dex 进行合并。
                patchDexFile(apk, patch, rawApkFileEntry, patchFileEntry, info, extractedFile);
            }
            //将合并后的 dex 重新打包成一个 apk，即 tinker_classN.apk。
            if (!mergeClassNDexFiles(context, patchFile, dir)) {
                return false;
            }
        }
        return true;
    }
}
```
### 阶段总结
到这里，Tinker 的初始化 和 patch 的处理已经全部结束。简单总结一下：

- Tinker 初始化：配置并创建了 Tinker 对象。给 TinkerPatchService 注入 UpgradePatch 和 DefaultTinkerResultService 对象。
- patch 下载完成后生效调用：
   - 启动 TinkerPatchService，其运行在 :patch 进程中。
   - 校验 patch 包。
   - 解析 patch.info 文件。（首次没有，生效一次后会写入文件）
   - 截取 patch 包的 MD5，以该字符串为名创建文件夹，并将 patch 包 copy 重命名。
   - 解析 patch 包中 dex_mate.txt 文件，并按照 dex 信息创建 dex 文件。
   - 将 dex 文件与原 apk 中 dex 文件进行合并。
   - 所有 dex 文件合并完成后，打包成一个 tinker_classN.apk 文件。
   - 对 tinker_classN.apk 进行 dex 加载优化。
   - 启动 DefaultTinkerResultService，告知热修复结果。（默认杀死应用进程）

Ok，这是从初始化->生效调用的整个流程，目前并没有看到 patch 包到底如何生效的。从官方文档可知 patch 真正生效是在下次启动，那么下面我们就看下具体是什么流程。
### Tinker Patch 真正生效
#### 前期准备
既然官方说下次启动生效，那必然是在 Application 中有操作了。我们就来看下 TinkerApplication 这个类。
```java
public abstract class TinkerApplication extends Application {
    
    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        onBaseContextAttached(base, applicationStartElapsedTime, applicationStartMillisTime);
    }

    protected void onBaseContextAttached(Context base, long applicationStartElapsedTime, long applicationStartMillisTime) {
        loadTinker();
    }

    //反射创建 TinkerLoader 对象，并调用其 tryLoad()。
    private void loadTinker() {
        try {
            Class<?> tinkerLoadClass = Class.forName(loaderClassName, false, TinkerApplication.class.getClassLoader());
            Method loadMethod = tinkerLoadClass.getMethod(TINKER_LOADER_METHOD, TinkerApplication.class);
            Constructor<?> constructor = tinkerLoadClass.getConstructor();
            tinkerResultIntent = (Intent) loadMethod.invoke(constructor.newInstance(), this);
        } catch (Throwable e) {
            //has exception, put exception error code
            tinkerResultIntent = new Intent();
            ShareIntentUtil.setIntentReturnCode(tinkerResultIntent, ShareConstants.ERROR_LOAD_PATCH_UNKNOWN_EXCEPTION);
            tinkerResultIntent.putExtra(INTENT_PATCH_EXCEPTION, e);
        }
    }
}
```
这里在 “支持修复 Application 中代码的原理” 一文中有提到过。当 Application 启动后会反射调用 TinkerLoader#tryLoad()，该方法会返回一个 Intent 对象，这就是上面 Tinker.install 时传入的 intentResult。<br />那接下来就看下 TinkerLoader#tryLoad() 都干了什么。
```java
public class TinkerLoader extends AbstractTinkerLoader {
    
    @Override
    public Intent tryLoad(TinkerApplication app) {
      
        Intent resultIntent = new Intent();
        tryLoadPatchFilesInternal(app, resultIntent);
        return resultIntent;
    }

    private void tryLoadPatchFilesInternal(TinkerApplication app, Intent resultIntent) {
        final int tinkerFlag = app.getTinkerFlags();

        //目录：/data/user/0/{packageName}/tinker
        File patchDirectoryFile = SharePatchFileUtil.getPatchDirectory(app);
        String patchDirectoryPath = patchDirectoryFile.getAbsolutePath();

        //解析 patch.info 信息。（在上面 patch 处理成功后，会将部分信息写入该文件中）
        File patchInfoFile = SharePatchFileUtil.getPatchInfoFile(patchDirectoryPath);
        File patchInfoLockFile = SharePatchFileUtil.getPatchInfoLockFile(patchDirectoryPath);
        patchInfo = SharePatchInfo.readAndCheckPropertyWithLock(patchInfoFile, patchInfoLockFile);

        final boolean isProtectedApp = patchInfo.isProtectedApp;
        resultIntent.putExtra(ShareIntentUtil.INTENT_IS_PROTECTED_APP, isProtectedApp);

        String oldVersion = patchInfo.oldVersion;
        String newVersion = patchInfo.newVersion;
        String oatDex = patchInfo.oatDir;

        boolean mainProcess = ShareTinkerInternals.isInMainProcess(app);
        boolean isRemoveNewVersion = patchInfo.isRemoveNewVersion;

        resultIntent.putExtra(ShareIntentUtil.INTENT_PATCH_OLD_VERSION, oldVersion);
        resultIntent.putExtra(ShareIntentUtil.INTENT_PATCH_NEW_VERSION, newVersion);

        boolean versionChanged = !(oldVersion.equals(newVersion));
        boolean oatModeChanged = oatDex.equals(ShareConstants.CHANING_DEX_OPTIMIZE_PATH);
        oatDex = ShareTinkerInternals.getCurrentOatMode(app, oatDex);
        resultIntent.putExtra(ShareIntentUtil.INTENT_PATCH_OAT_DIR, oatDex);

        String version = oldVersion;
        if (versionChanged && mainProcess) {
            version = newVersion;
        }

        //字符串截取，作为 patchName
        // 例如：
        //   bd38ab8e81d66976411eae3e4b871b67
        // 	 patchName = bd38ab8e
        String patchName = SharePatchFileUtil.getPatchVersionDirectory(version);
        
        //目录：/data/user/0/{packageName}/tinker/{patchName}
        String patchVersionDirectory = patchDirectoryPath + "/" + patchName;
        File patchVersionDirectoryFile = new File(patchVersionDirectory);

        //获取 {patchName}.apk。它就是在 UpgradePatch#tryPatch() 时 copy 重命名的 apk 文件。
        final String patchVersionFileRelPath = SharePatchFileUtil.getPatchVersionFile(version);
        File patchVersionFile = (patchVersionFileRelPath != null ? new File(patchVersionDirectoryFile.getAbsolutePath(), patchVersionFileRelPath) : null);

        ShareSecurityCheck securityCheck = new ShareSecurityCheck(app);

        //校验 patch 和原 apk 的签名、tinkerId、tinkerFlags
        int returnCode = ShareTinkerInternals.checkTinkerPackage(app, tinkerFlag, patchVersionFile, securityCheck);
        resultIntent.putExtra(ShareIntentUtil.INTENT_PATCH_PACKAGE_CONFIG, securityCheck.getPackagePropertiesIfPresent());

        //我们运行在 Android 12 设备中，这里判断的是鸿蒙，所以为 false
        final boolean isArkHotRuning = ShareTinkerInternals.isArkHotRuning();
    	// tinker flag 是否配置支持 dex。默认 flag = all，所以这里为 true。
        final boolean isEnabledForDex = ShareTinkerInternals.isTinkerEnabledForDex(tinkerFlag);
        //同上，这里为 true
        final boolean isEnabledForArkHot = ShareTinkerInternals.isTinkerEnabledForArkHot(tinkerFlag);

        if (!isArkHotRuning && isEnabledForDex) {
            //解析 dex_mate.txt 文件，并检查 tinker_classN.apk 和 dex 优化产物(.odex) 是否存在。
            boolean dexCheck = TinkerDexLoader.checkComplete(patchVersionDirectory, securityCheck, oatDex, resultIntent);
            if (!dexCheck) return;
        }

    	//....

        if (!isArkHotRuning && isEnabledForDex) {
            //加载热修复的 dex
            boolean loadTinkerJars = TinkerDexLoader.loadTinkerJars(app, patchVersionDirectory, oatDex, resultIntent, isSystemOTA, isProtectedApp);
            if (!loadTinkerJars) return;
        }

        //....

        //这里是新增组件（例如 Activity）的处理。咱们关注热修复（修改）所以略过。
        if ((isEnabledForDex || isEnabledForArkHot) && isEnabledForResource) {
            ComponentHotplug.install(app, securityCheck);
        }

        //....
        
        //all is ok!
        ShareIntentUtil.setIntentReturnCode(resultIntent, ShareConstants.ERROR_LOAD_OK);
    }
}
```
TinkerLoader#tryLoad() 代码很多，包含了所有的修复分支（例如：鸿蒙、source 等），这里我们只关注 Dex 修复。代码很多，但逻辑很清晰：

1. 拿到 {patchName}.apk，并校验.
2. 解析 dex_mate.txt 文件，为后面热修复 Dex 逻辑做准备。并检查 tinker_classN.apk 和 dex 优化产物是否存在。
3. 开始处理热修复 Dex。
#### 处理热修复 Dex
 下面咱们就看看怎么处理 Dex 的，即 TinkerDexLoader.loadTinkerJars() 的逻辑。
```java
public class TinkerDexLoader {
    public static boolean loadTinkerJars(final TinkerApplication application, String directory, String oatDir, Intent intentResult, boolean isSystemOTA, boolean isProtectedApp) {
       
        ClassLoader classLoader = TinkerDexLoader.class.getClassLoader();

        //目录：/data/user/0/{packageName}/tinker/dex/
        String dexPath = directory + "/" + DEX_PATH + "/";

        ArrayList<File> legalFiles = new ArrayList<>();

        //....

        // 校验 tinker_classN.apk
        if (isVmArt && !classNDexInfo.isEmpty()) {
        	File classNFile = new File(dexPath + ShareConstants.CLASS_N_APK_NAME);
            legalFiles.add(classNFile);
        }
        //目录：/data/user/0/{packageName}/tinker/odex
        File optimizeDir = new File(directory + "/" + oatDir);
        try {
            //在 ApplicationLike 注解中，默认为 false。
            final boolean useDLC = application.isUseDelegateLastClassLoader();
            SystemClassLoaderAdder.installDexes(application, classLoader, optimizeDir, legalFiles, isProtectedApp, useDLC);
        } catch (Throwable e) {
            return false;
        }
        return true;
    }
}
```
```java
public class SystemClassLoaderAdder {
    
    public static void installDexes(Application application, ClassLoader loader, File dexOptDir, List<File> files,
                                    boolean isProtectedApp, boolean useDLC) throws Throwable {
        ShareTinkerLog.i(TAG, "installDexes dexOptDir: " + dexOptDir.getAbsolutePath() + ", dex size:" + files.size());

        if (!files.isEmpty()) {
            
            ClassLoader classLoader = loader;
            if (Build.VERSION.SDK_INT >= 24 && !isProtectedApp) {
                //自定义 ClassLoader 加载
                classLoader = NewClassLoaderInjector.inject(application, loader, dexOptDir, useDLC, files);
            } else {
                //直接加载。上面自定义 ClassLoader 最后还是会走这里
                injectDexesInternal(classLoader, files, dexOptDir);
            }
            //install done
            sPatchDexCount = files.size();
            ShareTinkerLog.i(TAG, "after loaded classloader: " + classLoader + ", dex size:" + sPatchDexCount);

            if (!checkDexInstall(classLoader)) {
                //reset patch dex
                SystemClassLoaderAdder.uninstallPatchDex(classLoader);
                throw new TinkerRuntimeException(ShareConstants.CHECK_DEX_INSTALL_FAIL);
            }
        }
    }

    //根据不同的系统版本对 Dex Element 进行处理
    static void injectDexesInternal(ClassLoader cl, List<File> dexFiles, File optimizeDir) throws Throwable {
        if (Build.VERSION.SDK_INT >= 23) {
            V23.install(cl, dexFiles, optimizeDir);
        } else if (Build.VERSION.SDK_INT >= 19) {
            V19.install(cl, dexFiles, optimizeDir);
        } else if (Build.VERSION.SDK_INT >= 14) {
            V14.install(cl, dexFiles, optimizeDir);
        } else {
            V4.install(cl, dexFiles, optimizeDir);
        }
    }
}
```
```java
final class NewClassLoaderInjector {
    
    public static ClassLoader inject(Application app, ClassLoader oldClassLoader, File dexOptDir,
                                     boolean useDLC, List<File> patchedDexes) throws Throwable {

        //patchedDexPaths 只有一个元素，即 tinker_classN.apk 路径
        final String[] patchedDexPaths = new String[patchedDexes.size()];
        for (int i = 0; i < patchedDexPaths.length; ++i) {
            patchedDexPaths[i] = patchedDexes.get(i).getAbsolutePath();
        }
        //创建 TinkerClassLoader
        // TinkerClassLoader 在构造函数中又会调用到 SystemClassLoaderAdder#injectDexesInternal()
        final ClassLoader newClassLoader = createNewClassLoader(oldClassLoader,
              dexOptDir, useDLC, true, patchedDexPaths);

        //替换 ClassLoader，后面类加载都走 TinkerClassLoader
        doInject(app, newClassLoader);
        return newClassLoader;
    }
}
```
到这里 Tinker Dex 修复原理就告一段落了。关于 Patch 真正生效的部分，代码量很大，但逻辑非常清晰，里面包括了各种情况的处理（例如：鸿蒙、系统升级、资源热修复、so 热修复、新增组件等），我们仅分析了 Android 系统的 Dex 热修复部分。对于其他逻辑感兴趣的，可以自己查看。
### 总结
Tinker Dex 热修复部分的逻辑可以分为三大块：

- Tinker 初始化
- patch 下载后预处理
- patch Dex 加载

下面用一张图展示整体过程：<br />![](https://cdn.nlark.com/yuque/0/2023/jpeg/29688996/1692776627725-1db8b1f6-4355-4665-a4b6-580075d2d91f.jpeg)

