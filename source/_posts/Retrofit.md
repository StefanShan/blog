---
title: 源码解读 Retrofit
date: 2022/11/17
categories:
- [Android]
- [源码解读]
tags:
- Retrofit
---

> 源码基于 retrofit 2.9.0

# 常用方式
```kotlin
//创建接口
interface Api {
    @GET("/get/data")
    fun getRequest(): Call<Data>
}

//构建 retrofit
val retrofit = Retrofit.Builder()
    .baseUrl("https://www.baidu.com")
    .addConverterFactory(GsonConverterFactory.create())
    .build()

//获取接口对象
val api = retrofit.create(Api::class.java)

//调用 api
api.getRequest().enqueue(object : Callback<Data> {
    override fun onResponse(call: Call<Data>, response: Response<Data>) {

    }

    override fun onFailure(call: Call<Data>, t: Throwable) {
    }

})
```
<!-- more -->
# 源码
## Retrofit.Builder
```java
public Retrofit build() {

  //没有指定，则默认创建 OkHttpClient
  okhttp3.Call.Factory callFactory = this.callFactory;
  if (callFactory == null) {
    callFactory = new OkHttpClient();
  }

  //没有指定，则默认创建 Executor，这里是主线程！！！
  Executor callbackExecutor = this.callbackExecutor;
  if (callbackExecutor == null) {
    callbackExecutor = platform.defaultCallbackExecutor();
  }

  //保存传入的 callAdapter，以及一个默认的 CompletableFutureCallAdapterFactory(仅在android api 24+ 添加进去)、DefaultCallAdapterFactory
  List<CallAdapter.Factory> callAdapterFactories = new ArrayList<>(this.callAdapterFactories);
  callAdapterFactories.addAll(platform.defaultCallAdapterFactories(callbackExecutor));

  //保存 converterFactory，
  /** 注意这里的顺序：
   *    - 先放入一个内置converterFactory
   *    - 然后是自定义的
   *    - 最后放入默认的(如果 android api 24+ 是为 OptionalConverterFactory，其他为null)
   */
  List<Converter.Factory> converterFactories =
      new ArrayList<>(
          1 + this.converterFactories.size() + platform.defaultConverterFactoriesSize());
  converterFactories.add(new BuiltInConverters());
  converterFactories.addAll(this.converterFactories);
  converterFactories.addAll(platform.defaultConverterFactories());

  return new Retrofit(
      callFactory,
      baseUrl,
      unmodifiableList(converterFactories),
      unmodifiableList(callAdapterFactories),
      callbackExecutor,
      validateEagerly);
}
```
## Retrofit#create()
> 此链路为 retrofit.create(Api::class.java).getRequest()。整个流程下来之后得知返回的是 ExecutorCallbackCall

```java
  public <T> T create(final Class<T> service) {
    //验证 class 必须是 Interface
    validateService Interface(service);
    // 动态代理，创建 call
    return (T)
        Proxy.newProxyInstance(
            service.getClassLoader(),
            new Class<?>[] {service},
            new InvocationHandler() {
              private final Platform platform = Platform.get();
              private final Object[] emptyArgs = new Object[0];

              @Override
              public @Nullable Object invoke(Object proxy, Method method, @Nullable Object[] args)
                  throws Throwable {
                // If the method is a method from Object then defer to normal invocation.
                if (method.getDeclaringClass() == Object.class) {
                  return method.invoke(this, args);
                }
                args = args != null ? args : emptyArgs;
                //判断 api 24+ && method是定义在接口中的public的非静态非抽象的方法 是否为true
                // 这里 isDefaultMethod = false。走 loadServiceMethod()
                // loadServiceMethod() 获取到 ServiceMethod，然后调用 invoke()，实际调用的是 HttpServiceMethod.invoke()
                return platform.isDefaultMethod(method)
                    ? platform.invokeDefaultMethod(method, service, proxy, args)
                    : loadServiceMethod(method).invoke(args);
              }
            });
  }
```
```java
//获取 ServiceMethod
// 优先从缓存里面去读，没有则创建并放入缓存中。这里缓存是一个ConcurrentHashMap
// 这里获取的逻辑有点像单例中的双重检验
ServiceMethod<?> loadServiceMethod(Method method) {
    ServiceMethod<?> result = serviceMethodCache.get(method);
    if (result != null) return result;
    
    synchronized (serviceMethodCache) {
      result = serviceMethodCache.get(method);
      if (result == null) {
        result = ServiceMethod.parseAnnotations(this, method); //创建了一个 CallAdapted
        serviceMethodCache.put(method, result);
      }
    }
    return result;
}
```
### ServiceMethod#parseAnnotations()
```java
  static <T> ServiceMethod<T> parseAnnotations(Retrofit retrofit, Method method) {
    //创建 RequestFactory
    RequestFactory requestFactory = RequestFactory.parseAnnotations(retrofit, method);
	//创建了个 CallAdapted，该类继承自HttpServiceMethod
    return HttpServiceMethod.parseAnnotations(retrofit, method, requestFactory);
  }
```
### RequestFactory#parseAnnotations()
```java
  static RequestFactory parseAnnotations(Retrofit retrofit, Method method) {
    return new Builder(retrofit, method).build();
  }
```
```java
    Builder(Retrofit retrofit, Method method) {
      this.retrofit = retrofit;
      this.method = method;
      this.methodAnnotations = method.getAnnotations(); //获取注解
      this.parameterTypes = method.getGenericParameterTypes(); //获取参数类型
      this.parameterAnnotationsArray = method.getParameterAnnotations(); //获取参数注解
    }
```
```java
    RequestFactory build() {
       //处理注解，获取到 httpMethod(如 GET、POST)、url、paramsName等
      for (Annotation annotation : methodAnnotations) {
        parseMethodAnnotation(annotation);
      }  
        
      //处理参数注解，根据注解获取到对应的 ParameterHandler 子类，如:ParameterHandler.Query
      // 子类中包含了 注解name、参数类型
      int parameterCount = parameterAnnotationsArray.length;
      parameterHandlers = new ParameterHandler<?>[parameterCount];
      for (int p = 0, lastParameter = parameterCount - 1; p < parameterCount; p++) {
        parameterHandlers[p] =
            parseParameter(p, parameterTypes[p], parameterAnnotationsArray[p], p == lastParameter);
      }
      return new RequestFactory(this);
    }
```
### HttpServiceMethod#parseAnnotations()
```java
  static <ResponseT, ReturnT> HttpServiceMethod<ResponseT, ReturnT> parseAnnotations(
      Retrofit retrofit, Method method, RequestFactory requestFactory) {
    boolean isKotlinSuspendFunction = requestFactory.isKotlinSuspendFunction;
    boolean continuationWantsResponse = false;
    boolean continuationBodyNullable = false;

    Annotation[] annotations = method.getAnnotations(); //获取方法上的注解
    Type adapterType;
    if (isKotlinSuspendFunction) {
      //这里是协程的方式，先忽略
    } else {
      adapterType = method.getGenericReturnType(); //获取返回类型
    }

    //创建 CallAdapter，用于转换Okhttp的call
    //遍历所有callAdapter，如果没有自定义的话，因为常用返回的 Call<T>，所以假定走 DefaultCallAdapterFactory#get()，直接 new CallAdapter 对象
    CallAdapter<ResponseT, ReturnT> callAdapter =
        createCallAdapter(retrofit, method, adapterType, annotations);
    Type responseType = callAdapter.responseType();

    //创建 Converter，用于处理response
    Converter<ResponseBody, ResponseT> responseConverter =
        createResponseConverter(retrofit, method, responseType);

    //在创建 retrofit 未设置的话，默认就是 OkHttpClient
    okhttp3.Call.Factory callFactory = retrofit.callFactory;
    if (!isKotlinSuspendFunction) {
      //返回一个 CallAdapted,包含了请求的信息(requestFactory)、OkHttpClient(callFactory)、response转换器(responseConverter)、call转换器(callAdapter)
      return new CallAdapted<>(requestFactory, callFactory, responseConverter, callAdapter);
    } else if (continuationWantsResponse) {
      //...协程
    } else {
      //noinspection unchecked Kotlin compiler guarantees ReturnT to be Object.
    }
  }
```
### HttpServiceMethod#invoke()
```java
  final @Nullable ReturnT invoke(Object[] args) {
    //创建 OkHttpCall 对象，并调用 adapt()
    // adapt() 由子类来实现。接上面说的，这里调用的是 CallAdapted.adapt()
    Call<ResponseT> call = new OkHttpCall<>(requestFactory, args, callFactory, responseConverter);
    return adapt(call, args);
  }
```
### CallAdapted#adapt()
```java
    protected ReturnT adapt(Call<ResponseT> call, Object[] args) {
      //调用到 CallAdapter#adapt()。
      //假定方法返回类型是 Call，所以这里走 DefaultCallAdapterFactory#get()时 new CallAdapter#adapt()
      // 这里调用 adapt 实际返回的是 ExecutorCallbackCall()
      return callAdapter.adapt(call);
    }
```
```java
/**
 * 简单喽一眼 ExecutorCallbackCall 的创建过程，主要是为了看其中的入参 Executor
 */
public @Nullable CallAdapter<?, ?> get(
      Type returnType, Annotation[] annotations, Retrofit retrofit) {
    if (getRawType(returnType) != Call.class) {
      return null;
    }
    // 获取主线程
    final Executor executor =
        Utils.isAnnotationPresent(annotations, SkipCallbackExecutor.class)
            ? null
            : callbackExecutor;

    return new CallAdapter<Object, Call<?>>() {
      @Override
      public Type responseType() {
        return responseType;
      }

      @Override
      public Call<Object> adapt(Call<Object> call) {
        //返回 ExecutorCallbackCall 对象
        return executor == null ? call : new ExecutorCallbackCall<>(executor, call);
      }
    };
  }

```
## Call#enqueue()
```java
/**
 * 根据上面分析，这里实际调用的是 ExecutorCallbackCall#enqueue()
 */
public void enqueue(final Callback<T> callback) {

      // delegate 为OkHttpCall
      delegate.enqueue(
          new Callback<T>() {
            @Override
            public void onResponse(Call<T> call, final Response<T> response) {
              // 主线程回调
              callbackExecutor.execute(
                  () -> {
                    if (delegate.isCanceled()) {
                      // Emulate OkHttp's behavior of throwing/delivering an IOException on
                      // cancellation.
                      callback.onFailure(ExecutorCallbackCall.this, new IOException("Canceled"));
                    } else {
                      callback.onResponse(ExecutorCallbackCall.this, response);
                    }
                  });
            }

            @Override
            public void onFailure(Call<T> call, final Throwable t) {
              callbackExecutor.execute(() -> callback.onFailure(ExecutorCallbackCall.this, t));
            }
          });
    }
```
### OkHttpCall#enqueue
```java
  public void enqueue(final Callback<T> callback) {


    okhttp3.Call call;
    Throwable failure;

    synchronized (this) {
      if (executed) throw new IllegalStateException("Already executed.");
      executed = true;

      call = rawCall;
      failure = creationFailure;
      if (call == null && failure == null) {
        try {
          call = rawCall = createRawCall();  //实际调用 OkHttpClient.newCall 创建 OkHttp 的 Call
        } catch (Throwable t) {
          throwIfFatal(t);
          failure = creationFailure = t;
        }
      }
    }

    //执行 OkHttp 的 enqueue 流程
    call.enqueue(
        new okhttp3.Callback() {
          @Override
          public void onResponse(okhttp3.Call call, okhttp3.Response rawResponse) {
            Response<T> response;
            try {
              //处理返回的 Response，调用 responseConverter.convert 进行处理
              response = parseResponse(rawResponse);
            } catch (Throwable e) {
              throwIfFatal(e);
              callFailure(e);
              return;
            }

            try {
              callback.onResponse(OkHttpCall.this, response);
            } catch (Throwable t) {
              throwIfFatal(t);
              t.printStackTrace(); // TODO this is not great
            }
          }

          @Override
          public void onFailure(okhttp3.Call call, IOException e) {
            callFailure(e);
          }

          private void callFailure(Throwable e) {
            try {
              callback.onFailure(OkHttpCall.this, e);
            } catch (Throwable t) {
              throwIfFatal(t);
              t.printStackTrace(); // TODO this is not great
            }
          }
        });
  }
```
```java
/**
 * 看下 OkHttp 的 Call 如何创建的
 */
  private okhttp3.Call createRawCall() throws IOException {
    // callFactory 就是 Retrofit.build 是创建的 OkHttpClient
    // requestFactory.create(args) 是构建 OkHttpRequest
    okhttp3.Call call = callFactory.newCall(requestFactory.create(args));
    if (call == null) {
      throw new NullPointerException("Call.Factory returned null.");
    }
    return call;
  }
```
# 参考资料
[Method详解](#Mtqz8)
