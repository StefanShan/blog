---
title: 通过实例了解 getLayoutInflater().inflate() 与 View.inflate() 的区别
date: 2019/9/17 22:39:00
categories:
- 踩坑记录/问题合集
tags: 
- Android
- LayoutInflate源码
---

BRVAH（BaseRecyclerViewAdapterHelper）这个框架我想做Android的应该都比较熟悉了，如果不熟悉的可以百度，这里就不啰嗦了。最近在使用该框架给横向　RecyclerView　添加底部布局时出现了问题：
添加的底部布局(footer_view)的 layout_width 和 layout_height 都是写死的值，但是当 add 进去之后滑动 RecyclerView 到最后一个，footer_view 独自占据了一屏幕，而且footer_view 高度变成了 wrap_content。

<!-- more -->

代码如下
```xml
//布局样式
<android.support.constraint.ConstraintLayout 
    xmlns:android="http://schemas.android.com/apk/res/android"   
    xmlns:app="http://schemas.android.com/apk/res-auto"    
    xmlns:tools="http://schemas.android.com/tools"    
    android:id="@+id/cl_random_author_foot"    
    android:layout_width="121dp"    
    android:layout_height="160dp" 
    android:layout_marginEnd="12dp"    
    android:background="@drawable/shape_random_author_item_bg">
</android.support.constraint.ConstraintLayout>
```
```kotlin
    //代码
    val randomAuthorFootView = View.inflate(context,R.layout.recycler_view_foot_random_author, null)
    randomAuthorAdapter.addFooterView(randomAuthorFootView)
```
效果如下图所示：
![LayoutInflater1.gif](/images/getLayoutInflater().inflate()与View.inflate()的区别/LayoutInflater1.gif)

一、先看第一个问题：底部布局已经写死了值，但是为什么宽变成 match_parent，高变成 wrap_content 了。
因为代码中只有两行，那就依次分析吧，先看一下 View.inflate 源码里面是怎么创建 view 的吧。
```java
/** 
* Inflate a view from an XML resource.  This convenience method wraps the {@link * LayoutInflater} class, which provides a full range of options for view 
inflation. 
* 
* @param context The Context object for your activity or application. 
* @param resource The resource ID to inflate 
* @param root A view group that will be the parent.  Used to properly inflate the * layout_* parameters. 
* @see LayoutInflater 
*/
public static View inflate(Context context, @LayoutRes int resource, ViewGroup root) {    
    LayoutInflater factory = LayoutInflater.from(context);    
    return  factory.inflate(resource, root);
}
```
通过源码可以发现，View.inflate 通过 LayoutInflater.from(context) 然后调用 inflate 方法，这与 getLayoutInflater().inflate 最终调用的是同一个方法，只是参数不同。那我们再看一下 factory.inflate(resource, root) 里面都执行了什么。
```java
public View inflate(@LayoutRes int resource, @Nullable ViewGroup root) {    
    return inflate(resource, root, root != null);
}
```
这里面只有一句，将参数进行了添加，这样后面执行的就和 layoutInflater.inflate 是同样的代码了。
```java
public View inflate(@LayoutRes int resource, @Nullable ViewGroup root, boolean attachToRoot) {    
    final Resources res = getContext().getResources();    
    if (DEBUG) {        
        Log.d(TAG, "INFLATING from resource: \"" + res.getResourceName(resource) + "\" (" + Integer.toHexString(resource) + ")");   
     }    
     final XmlResourceParser parser = res.getLayout(resource);    
     try {        
        return inflate(parser, root, attachToRoot);    
     } finally {       
        parser.close();    
     }
}
```
这里代码很简单，将添加的 view 视图进行了解析，然后又调用了 inflate 方法，我们再往下看。
```java
public View inflate(XmlPullParser parser, @Nullable ViewGroup root, boolean 
attachToRoot) {
    ....省略....
    // Temp is the root view that was found in the xml
    final View temp = createViewFromTag(root, name, inflaterContext, attrs);
    ViewGroup.LayoutParams params = null;
    if (root != null) {    
        if (DEBUG) {
            System.out.println("Creating params from root: " + root);    
        }   
        // Create layout params that match root, if supplied    
        params = root.generateLayoutParams(attrs);    
        if (!attachToRoot) {       
            // Set the layout params for temp if we are not       
            // attaching. (If we are, we use addView, below)        
            temp.setLayoutParams(params);    
       }
   }
   ....省略....
   //We are supposed to attach all the views we found (int temp)
   // to root. Do that now.
   if (root != null && attachToRoot) {
        root.addView(temp, params);}
        // Decide whether to return the root that was passed in or the
        // top view found in xml.
        if (root == null || !attachToRoot) {    
            result = temp;
       }
   }
  ....省略....
}
```
终于到最核心的地方了，在调用 View.inflate 时 root 传入的是 null，那到这一步入参就是 inflate(parser, null, false)，因此会直接走 reslut = temp 这一步，在创建 temp 时会调用 ViewGroup 的 generateDefaultLayoutParams() 方法将宽高全部设置成wrap_content。所以添加的底部布局宽高应该都是 wrap_content。
二、到这里我们知道了底部布局为什么高度是 wrap_content，但是还有两个疑问：1. 宽度为什么是 match_parent ；2. 怎么让宽高都按照设置的值进行显示。
接下来咱们先解决第二个问题（怎么让宽高都按照设置的值进行显示），根据源码可以知道要想设置固定值得宽高，root 必须不能为空 而且 attachToRoot 必须为 false。根据这两个我们可以知道 View.inflate 是不能满足的了，那咱们就换用 layoutInflater.inflate 试试。根据源码可以知道，layoutInflater.infate 会直接走到 public View inflate(@LayoutRes int resource, @Nullable ViewGroup root, boolean attachToRoot) 这一步，那要想满足上面两个条件就好办了，首先随便找一个 ViewGroup 作为 root，然后再让 attachToRoot 等于 false。代码如下：
```java
layoutInflater.inflate(R.layout.recycler_view_foot_random_author, recyclerViewAuthor, false)
```
效果如下：
![LayoutInflater2.gif](/images/getLayoutInflater().inflate()与View.inflate()的区别/LayoutInflater2.gif)

通过效果图可以发现，高度已经不是 wrap_content，同时宽度也没有变成 match_parent ，一举两得。但还是有问题：底部布局宽度虽然没有 match_parent，但是仍然单独占据了一屏幕。通过刚才的分析可以知道，创建底部布局是没有任何问题的了，那么问题一定是在添加的时候。那我们就来看看 adapter.addFooterView() 这个方法吧。
```java
/** 
* Append footer to the rear of the mFooterLayout. 
* 
* @param footer 
*/
public int addFooterView(View footer) {    
    return addFooterView(footer, -1, LinearLayout.VERTICAL);
}
```
通过源码可以发现，原来是做了默认配置，而且是单独添加的方向并不是通过 recyclerView 的 layoutManager 来判断方向的。那我们就自己来设置方向。
```java
randomAuthorAdapter.addFooterView(randomAuthorFootView, -1, LinearLayout.HORIZONTAL)
```
再看效果
![LayoutInflater3.gif](/images/getLayoutInflater().inflate()与View.inflate()的区别/LayoutInflater3.gif)
ok，问题全部解决。让我们来总结一下：

1. getLayoutInflater().inflate() 与 View.inflate() 以及 LayoutInflater.from(this).inflate() 最终都是调用都是同一个方法。
2. 使用 View.inflate() 时，root 传 null，则生成的 View 宽高均为 wrap_content，并不会根据设定的 layout_width 和 layout_height 去显示；若 root 不为空，则会将想要生成的 view 直接添加到 root 中，并返回 root。
3. 使用 getLayoutInflater().inflate() 时，若 root 不为空，同时 attachToRoot 为 false，则生成的 View 宽高为设定的 layout_width 和 layout_height 去显示；若 root 为空，attachToRoot 为 false，则生成的 View 宽高均为 wrap_content。
