---
title: 自动刷新Token并重新发送请求
date: 2023/07/15
categories:
- [网络]
tags:
- OkHttp
- Retrofit
---
<!-- more -->

```kotlin
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.Response
import org.json.JSONObject
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import java.util.Locale

//Token请求失败时，自动刷新Token并重试请求
class AutoRefreshTokenInterceptor : Interceptor {

    private val UTF8 = StandardCharsets.UTF_8

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
    	//如果 url path 是刷新token，则放行
        if (request.url.toUrl().path == "/auth/refresh") return chain.proceed(request)
        synchronized(AutoRefreshTokenInterceptor::class.java) {
            val localToken = IAccountService.getImpl().getToken()
            if (request.header("Authorization") != localToken) {
                //请求携带的 token 与本地不一致，避免重复请求刷新 token
                val newRequest = request.newBuilder()
                    .header("Authorization", localToken ?: "").build()
                return chain.proceed(newRequest)
            }
            val response = chain.proceed(request)
            if (response.isSuccessful.not()) return response
            val cloneRespBody = response.body
            if (cloneRespBody == null || !isPlaintext(cloneRespBody.contentType())) return response
            val bodyStr = cloneRespBody.source().let {
                it.request(Long.MAX_VALUE)
                it.buffer
            }.clone().readString(getCharset(cloneRespBody.contentType()))
            val serverCode = JSONObject(bodyStr)["code"].let {
                if (it is String) it.toInt() else it
            }
            //判断服务端返回code 是否为 token 问题导致的失败。
            if (serverCode == COMM.TOKEN_BRACE || serverCode == COMM.TOKEN_BRACE2 || serverCode == COMM.TOKEN_PAST) {
                //Token原因请求失败，刷新Token重新请求
                val newToken = IAccountService.getImpl().refreshTokenWithSync()
                if (newToken == null){
                    //刷新失败，只能跳登录了。LoginActivity lauchMode= singleTask
                    StartActivityUtil.startActivity(StartActivityUtil.LoginActivity)
                    return response
                }
                //携带刷新后 token 重新请求
                val newRequest = request.newBuilder()
                    .header("Authorization", newToken).build()
                return chain.proceed(newRequest)
            }
            return response
        }
    }

    private fun isPlaintext(mediaType: MediaType?): Boolean {
        if (mediaType?.type == null) return false
        if (mediaType.type == "text") {
            return true
        }
        var subtype = mediaType.subtype ?: return false
        subtype = subtype.lowercase(Locale.getDefault())
        return subtype.contains("x-www-form-urlencoded")
        || subtype.contains("json")
        || subtype.contains("xml")
        || subtype.contains("html")
    }

    private fun getCharset(contentType: MediaType?): Charset {
        return if (contentType != null) contentType.charset(UTF8)!! else UTF8
    }
}
```
