---
title: Tinker Patch 包生效原理 - Resource
date: 2023/08/25
categories:
- [Android]
- [源码解读]
- [Tinker]
tags:
- Tinker
---
> 本篇直接讲述调用原理，关于 Tinker 初始化、Patch 下载生效、下次启动等流程细节后直接省略，想了解这部分细节的话可以参照 Dex 生效篇。

## patch 生效调用
书接上回，Patch 包下载之后会调用到 UpgradePatch#tryPatch()，该方法包含了 Dex、Resource、So 的合并处理逻辑。下面咱们看下 Resource 部分的逻辑。
```java
public class UpgradePatch extends AbstractPatch {

    @Override
    public boolean tryPatch(Context context, String tempPatchPath, PatchResult patchResult) {
        //前面包含 文件解析、md5 校验、copy patch 包等操作，具体可看 Dex 生效篇 ...

        /**
     	 * @params manager  				Tinker 对象
         * @params signatureCheck  			ShareSecurityCheck 对象，包含一些读取与解析 patch 的逻辑
         * @params context 					上下文
         * @params patchVersionDirectory	路径：/data/user/0/{packageName}/thinker/{patchName}/
         * @params destPatchFile 			copy 后的 patch 包，路径：/data/user/0/{packageName}/thinker/{patchName}/{patchName}.apk
     	 */
        if (!ResDiffPatchInternal.tryRecoverResourceFiles(manager, signatureCheck, context, patchVersionDirectory, destPatchFile)) {
            return false;
        }

        //...

    }
}
```
<!-- more -->

和 Dex 处理一样，都是单独的类与方法来处理，这里体现了单一职责的思想。下面看 ResDiffPatchInternal#tryRecoverResourceFiles() 具体如何处理。
```java
public class ResDiffPatchInternal extends BasePatchInternal {
    
    protected static boolean tryRecoverResourceFiles(Tinker manager, ShareSecurityCheck checker, Context context,
                                                String patchVersionDirectory, File patchFile) {

        //读取 assets/res_meta.txt 文件
        String resourceMeta = checker.getMetaContentMap().get(RES_META_FILE);

        boolean result = patchResourceExtractViaResourceDiff(context, patchVersionDirectory, resourceMeta, patchFile);
        return result;
    }

    private static boolean patchResourceExtractViaResourceDiff(Context context, String patchVersionDirectory,
                                                               String meta, File patchFile) {

        //路径：/data/user/0/{packageName}/thinker/{patchName}/res/
        String dir = patchVersionDirectory + "/" + ShareConstants.RES_PATH + "/";

        //下面正式开始处理 patch 中 resource 相关数据
        if (!extractResourceDiffInternals(context, dir, meta, patchFile, TYPE_RESOURCE)) {
            return false;
        }
        return true;
    }

    private static boolean extractResourceDiffInternals(Context context, String dir, String meta, File patchFile, int type) {

        ShareResPatchInfo resPatchInfo = new ShareResPatchInfo();

        // 解析 assets/res_meta.txt。在前面已经读取该文件，这一步来解析。
        ShareResPatchInfo.parseAllResPatchInfo(meta, resPatchInfo);

        Tinker manager = Tinker.with(context);

        // 路径：/data/user/0/{packageName}/thinker/{patchName}/res/
        File directory = new File(dir);

        //路径：/data/user/0/{packageName}/thinker/{patchName}/res/res_temp/
        File tempResFileDirectory = new File(directory, "res_temp");

        //路径：/data/user/0/{packageName}/thinker/{patchName}/res/resources.apk
        File resOutput = new File(directory, ShareConstants.RES_NAME);

        // 创建 res 文件夹。路径：/data/user/0/{packageName}/thinker/{patchName}/res/
        resOutput.getParentFile().mkdirs();

        //获取原 apk 路径
        ApplicationInfo applicationInfo = context.getApplicationInfo();
        String apkPath = applicationInfo.sourceDir;

    	//处理标记为 large modify 和 store 的文件，
        //  将 store 标记的文件移动（IOStream）到 tempResFileDirectory 目录下
        //  将 large modify 标记的文件，与原 apk 中的合并，然后存储在 tempResFileDirectory 目录下
        if (!checkAndExtractResourceLargeFile(context, apkPath, directory, tempResFileDirectory, patchFile, resPatchInfo, type)) {
            return false;
        }

        TinkerZipOutputStream out = null;
        TinkerZipFile oldApk = null;
        TinkerZipFile newApk = null;
        int totalEntryCount = 0;
        try {
            out = new TinkerZipOutputStream(new BufferedOutputStream(new FileOutputStream(resOutput)));
            oldApk = new TinkerZipFile(apkPath);
            newApk = new TinkerZipFile(patchFile);
            final Enumeration<? extends TinkerZipEntry> entries = oldApk.entries();
            while (entries.hasMoreElements()) {
                TinkerZipEntry zipEntry = entries.nextElement();
                if (zipEntry == null) {
                    throw new TinkerRuntimeException("zipEntry is null when get from oldApk");
                }
                String name = zipEntry.getName();
                if (name.contains("../")) {
                    continue;
                }
                if (ShareResPatchInfo.checkFileInPattern(resPatchInfo.patterns, name)) {
                    //如不属于 delete、mod、largeMod、AndroidManifest，则直接调用 extractTinkerEntry()，内部就是将这个 entry 添加到 resources.apk 中
                    if (!resPatchInfo.deleteRes.contains(name)
                        && !resPatchInfo.modRes.contains(name)
                        && !resPatchInfo.largeModRes.contains(name)
                        && !name.equals(ShareConstants.RES_MANIFEST)) {
                        TinkerZipUtil.extractTinkerEntry(oldApk, zipEntry, out);
                        totalEntryCount++;
                    }
                }
            }

            //将 AndroidManifest 添加到 resources.apk 中
            TinkerZipEntry manifestZipEntry = oldApk.getEntry(ShareConstants.RES_MANIFEST);
            TinkerZipUtil.extractTinkerEntry(oldApk, manifestZipEntry, out);
            totalEntryCount++;

            // 将 "大修改" 的资源添加到 resources.apk 中
            for (String name : resPatchInfo.largeModRes) {
                TinkerZipEntry largeZipEntry = oldApk.getEntry(name);
                ShareResPatchInfo.LargeModeInfo largeModeInfo = resPatchInfo.largeModMap.get(name);
                TinkerZipUtil.extractLargeModifyFile(largeZipEntry, largeModeInfo.file, largeModeInfo.crc, out);
                totalEntryCount++;
            }

            // 将 新增 的资源对应 entry 添加到 resources.apk 中
            for (String name : resPatchInfo.addRes) {
                TinkerZipEntry addZipEntry = newApk.getEntry(name);
                if (resPatchInfo.storeRes.containsKey(name)) {
                    File storeFile = resPatchInfo.storeRes.get(name);
                    TinkerZipUtil.extractLargeModifyFile(addZipEntry, storeFile, addZipEntry.getCrc(), out);
                } else {
                    TinkerZipUtil.extractTinkerEntry(newApk, addZipEntry, out);
                }
                totalEntryCount++;
            }

            // 将 修改 的资源对应 entry 添加到 resources.apk 中
            for (String name : resPatchInfo.modRes) {
                TinkerZipEntry modZipEntry = newApk.getEntry(name);
                if (resPatchInfo.storeRes.containsKey(name)) {
                    File storeFile = resPatchInfo.storeRes.get(name);
                    TinkerZipUtil.extractLargeModifyFile(modZipEntry, storeFile, modZipEntry.getCrc(), out);
                } else {
                    TinkerZipUtil.extractTinkerEntry(newApk, modZipEntry, out);
                }
                totalEntryCount++;
            }
            // set comment back
            out.setComment(oldApk.getComment());
        } finally {
            IOHelper.closeQuietly(out);
            IOHelper.closeQuietly(oldApk);
            IOHelper.closeQuietly(newApk);
            //delete temp files
            SharePatchFileUtil.deleteDir(tempResFileDirectory);
        }
        // 最后校验一下生成的 resources.apk
        boolean result = SharePatchFileUtil.checkResourceArscMd5(resOutput, resPatchInfo.resArscMd5);
        return true;
    }
}
```
代码稍微有点多，但逻辑非常清晰，主要做了如下几步：

1. 解析 patch 包中 assets/res_meta.txt  文件，该文件标记了所有文件的修改内容，如：新增、删除、修改哪些资源，以及修改后的 resources.arsc。
2. 预处理 large mod 和 store 标记的文件，并存放在 /data/user/0/{packageName}/thinker/{patchName}/res/res_temp/  目录下。
3. 对 res_meta.txt 文件中标记的资源进行处理，最终融合到 resources.apk 中。
## patch 真正生效
 Resource 和 Dex 一样，都是在 Application 启动后调用到 TinkerLoader#tryload()，下面我们就裁剪代码，着重看下 patch 中 Resource 是如何生效的。
```java
public class TinkerLoader extends AbstractTinkerLoader {
    
    @Override
    public Intent tryLoad(TinkerApplication app) {
      
        Intent resultIntent = new Intent();
        tryLoadPatchFilesInternal(app, resultIntent);
        return resultIntent;
    }

    private void tryLoadPatchFilesInternal(TinkerApplication app, Intent resultIntent) {

        //....

        // 验证 flag 中是否有标记支持 resource 修复。默认为 ALL
        final boolean isEnabledForResource = ShareTinkerInternals.isTinkerEnabledForResource(tinkerFlag);
        if (isEnabledForResource) {
            // 检测 resource patch 是否存在（即 resources.apk）， 以及检测是否支持修复（即 反射拿到需要的类和字段，如果拿不到，说明不支持修复）
            boolean resourceCheck = TinkerResourceLoader.checkComplete(app, patchVersionDirectory, securityCheck, resultIntent);
            if (!resourceCheck) return;
        }

        //....

        if (isEnabledForResource) {
            /**
             * 开始修复
             * 
             * @params app						Application
             * @params patchVersionDirectory	路径：/data/user/0/{packageName}/tinker/{patchName}
             * @params resultIntent				承载结果的 Intent
             */
            boolean loadTinkerResources = TinkerResourceLoader.loadTinkerResources(app, patchVersionDirectory, resultIntent);
            if (!loadTinkerResources) return;
        }

        //...
    }
}
```
 上面代码与 Dex 基本一直，先校验是否可以修复，之后调用 TinkerResourceLoader#loadTinkerResources() 开始修复。
```java
public class TinkerResourceLoader {
    
    public static boolean loadTinkerResources(TinkerApplication application, String directory, Intent intentResult) {

        //路径：/data/user/0/{packageName}/tinker/{patchName}/res/resources.apk
        String resourceString = directory + "/" + RESOURCE_PATH +  "/" + RESOURCE_FILE;
        File resourceFile = new File(resourceString);

        //默认为 fase。具体配置在“支持修复 Application 原理”篇有介绍。
        if (application.isTinkerLoadVerifyFlag()) {
            //...
        }
        try {
            //
            TinkerResourcePatcher.monkeyPatchExistingResources(application, resourceString);
        } catch (Throwable e) {
            intentResult.putExtra(ShareIntentUtil.INTENT_PATCH_EXCEPTION, e);
            ShareIntentUtil.setIntentReturnCode(intentResult, ShareConstants.ERROR_LOAD_PATCH_VERSION_RESOURCE_LOAD_EXCEPTION);
            return false;
        }
        return true;
    }
}
```
```java
class TinkerResourcePatcher {

    // 下面代码中用到的部分类字段是在上面调用 TinkerResourceLoader.checkComplete() 时生成的。
    public static void monkeyPatchExistingResources(Context context, String externalResourceFile) throws Throwable {

        //...

    	final ApplicationInfo appInfo = context.getApplicationInfo();

        final Field[] packagesFields;
        // packagesFiled  反射获取 android.app.ActivityThread#mPackages 字段
        // resourcePackagesFiled 反射获取 android.app.ActivityThread#mResourcePackages 字段
        if (Build.VERSION.SDK_INT < 27) {
            packagesFields = new Field[]{packagesFiled, resourcePackagesFiled};
        } else {
            packagesFields = new Field[]{packagesFiled};
        }

        //这里假设 Android os > 8.0，所以 packagesFields 中只有一个元素 android.app.ActivityThread#mPackages
        for (Field field : packagesFields) {
            final Object value = field.get(currentActivityThread);

            for (Map.Entry<String, WeakReference<?>> entry
                    : ((Map<String, WeakReference<?>>) value).entrySet()) {
                final Object loadedApk = entry.getValue().get();
                if (loadedApk == null) {
                    continue;
                }
                //resDir 是反射获取 android.app.LoadedApk#mResDir 或 android.app.ActivityThread$PackageInfo#mResDir(LoadApk中获取异常时走这里) 字段
                final String resDirPath = (String) resDir.get(loadedApk);
                if (appInfo.sourceDir.equals(resDirPath)) {
                    //给 LoadedApk 设置 mResDir 指向 resources.apk
                    resDir.set(loadedApk, externalResourceFile);
                }
            }
        }

        //获取 AssetManager 对象
        newAssetManager = (AssetManager) newAssetManagerCtor.newInstance();

        // 调用 AssetManager#addAssetPath() 使用新创建的 AssetManager 来加载 resources.apk 资源
        if (((Integer) addAssetPathMethod.invoke(newAssetManager, externalResourceFile)) == 0) {
            throw new IllegalStateException("Could not create new AssetManager");
        }

        //...
        
        installResourceInsuranceHacks(context, externalResourceFile);
    }

    private static void installResourceInsuranceHacks(Context context, String patchedResApkPath) {

        try {
            //反射调用 android.app.ActivityThread#currentActivityThread() 获取 ActivityThread 对象
            final Object activityThread = ShareReflectUtil.getActivityThread(context, null);
            // 反射获取 ActivityThread#Handler 对象
            final Field mHField = ShareReflectUtil.findField(activityThread, "mH");
            final Handler mH = (Handler) mHField.get(activityThread);
            //反射获取 ActivityThread#Handler#mCallback  对象
            final Field mCallbackField = ShareReflectUtil.findField(Handler.class, "mCallback");
            final Handler.Callback originCallback = (Handler.Callback) mCallbackField.get(mH);
            //注入自定义的 Callback，监听系统消息，每次启动或重启等操作时，都回触发 monkeyPatchExistingResources() 来替换资源路径
            if (!(originCallback instanceof ResourceInsuranceHandlerCallback)) {
                final ResourceInsuranceHandlerCallback hackCallback = new ResourceInsuranceHandlerCallback(
                        context, patchedResApkPath, originCallback, mH.getClass());
                mCallbackField.set(mH, hackCallback);
            }
        } catch (Throwable thr) {
            ShareTinkerLog.printErrStackTrace(TAG, thr, "failed to install resource insurance hack.");
        }
    }
}
```
主要逻辑集中在 TinkerResourcePatcher#monkeyPatchExistingResources() 算法，将 resources.apk 指向到 LoadedApk 和创建新 AssetManager 来加载 resources.apk。这样在加载资源时，会获取 resources.apk 中的资源。
