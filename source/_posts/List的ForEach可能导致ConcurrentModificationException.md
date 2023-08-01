---
title: List 的 ForEach 可能导致 ConcurrentModificationException?
date: 2020/2/24 20:03:00
categories:
- 踩坑记录/问题合集
tags: 
- Android
- Java
- ConcurrentModificationException
---
#### 问题：
ConcurrentModificationException 问题多出现在 List 的 forEach 或者 Iterator 循环中，调用 List 中的方法操作数据。
例如：
```java
//List Iterator 循环里操作数据
public static void main(String[] args) {
    ArrayList<int> list=new ArrayList<String>();
    list.add("a");
    list.add("b");
    list.add("c");
    
    Iterator<String> iterator=list.iterator();
    while(iterator.hasNext()){
        String str = iterator.next();
        if(str.equals("a"){
            list.remove("a");
        }
    }
    System.out.println(list);
}

//List forEach 循环里操作数据
public static void main(String[] args) {
    ArrayList<int> list=new ArrayList<String>();
    list.add("a");
    list.add("b");
    list.add("c");
    
    for(String str : list){
        if(str.equals("a"){
            list.remove("a");
        }
    }
    System.out.println(list);
}
```
上面两种情况都会导致 ConcurrentModificationException，那么这是为什么呢？
<!-- more -->

#### 原因：<br>
在分析之前先了解一点，其实 List 的 forEach 就是 Iterator,是 List 创建了一个内部类 Itr 去实现 Iterator 接口，所以下面不会区分这两种情况，以 ArrayList forEach 进行分析。<br>
知道了 forEach 其实就是通过 Itr 来实现的循环的，那么咱们来看看这个类。
```java
private class Itr implements Iterator<E> {
    protected int limit = ArrayList.this.size;
    // 第一个元素的游标
    int cursor;
    // 上一个元素的游标
    int lastRet = -1; 
    // expectedModCount：Itr 维护的一个 List 修改记录
    // modCount：List 维护的一个 List 修改记录
    int expectedModCount = modCount;

    public boolean hasNext() {
        return cursor < limit;
    }

    @SuppressWarnings("unchecked")
    public E next() {
        if (modCount != expectedModCount)
            throw new ConcurrentModificationException();
        int i = cursor;
        if (i >= limit)
            throw new NoSuchElementException();
        Object[] elementData = ArrayList.this.elementData;
        if (i >= elementData.length)
            throw new ConcurrentModificationException();
        cursor = i + 1;
        return (E) elementData[lastRet = i];
    }
    .... 其余代码省略 ....
}
```
&emsp; 前面说到过 forEach 就是 Iterator 实现的，这里的 hasNext() 方法是用来判断是否还有数据需要遍历，而关键的就在 next() 方法中。这个方法是用来获取下一个元素的，但在获取之前做了一个判断，就是 Itr 维护的修改记录(expectedModCount)要和 List 维护的修改记录(modCount)相等才能继续，不然说明数据源已经被修改了，这时获取到的下一个元素已经不准确了。</br>
&emsp; 再来看怎样会导致两个类维护的变量不一致。（以 remove() 方法为例）
```java
public boolean remove(Object o) {
    if (o == null) {
        for (int index = 0; index < size; index++)
            if (elementData[index] == null) {
                fastRemove(index);
                return true;
            }
    } else {
        for (int index = 0; index < size; index++)
            if (o.equals(elementData[index])) {
                fastRemove(index);
                return true;
            }
    }
    return false;
}

private void fastRemove(int index) {
    modCount++;
    int numMoved = size - index - 1;
    if (numMoved > 0){
        System.arraycopy(elementData, index+1, elementData, index,numMoved);
    }
    elementData[--size] = null; // clear to let GC do its work
}
```
&emsp;上面代码可以看出 remove() 方法调用 fastRemove() 方法，实现删除数据，并且将 List 维护的修改记录(modCount)+1，但是此时 Itr 中维护的修改记录(expectedModCount) 并没有改变。<br>
&emsp; 将上面两部分总结一下就是：List 的 forEach 循环就是利用 List 内部类 Itr 实现的。Itr 中维护了一个 List 修改记录变量 expectedModCount，List 中也维护了一个修改记录变量 modCount。如果你在 forEach 或者 Iterator 循环中调用 List 类的操作数据方法，此时只是修改的 modCount，在循环取下一个元素时（即调用 Itr 的 next() 方法），由于 expectedModCount 与 modCount 已经不相等，导致抛出 ConcurrentModificationException，来告诉你 List 已经被修改了，此时获取 List 中的元素已经是不准确的了。<br>
#### 解决方法：
1. 使用 Itr 中的方法操作数据
2. 不使用 Iterator 或者 forEach 循环，使用 for 循环自己维护索引
3. 使用并发包提供的集合类存储与处理数据，例如 CopyOnArrayList 等