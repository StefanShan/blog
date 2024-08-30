import { defineConfig } from 'vitepress'
import timeline from "vitepress-markdown-timeline"; 

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "青杉",
  description: "Java、Kotlin、Dart、JS/TS、Android、Flutter、前端、后端、开发总结、读书笔记、所思所想",
  base: "/blog/",
  //匹配应排除作为源内容输出的 markdown 文件
  srcExclude: ['**/README.md', '**/TODO.md', '**/templete.md'],
  markdown: { 
    //行号显示
    lineNumbers: true, 

    //时间线
    config: (md) => {
      md.use(timeline);
    },
  }, 
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config

    //顶部导航栏
    nav: [
      { text: '主页', link: '/' },
      { text: '归档', link: '/archive' },
      { text: '关于', link: '/about' }
      // {
      //   text: '后端', items: [
      //     { text: 'Node', link: '/test', activeMatch: '/Node/' },
      //     { text: 'Kotlin', link: '/test', activeMatch: '/Kotlin/' }
      //   ]
      // }
    ],

    //侧边栏
    sidebar: {
      'doc': [
        {
          text: '开发知识库',
          items: [
            {
              text: '后端开发',
              collapsed: true,
              items: [
                { text: "Docker学习笔记", link: '/doc/后端开发/Docker学习笔记'},
              ]
            },
            {
              text: 'Java',
              collapsed: true,
              items: [
                { text: '实例讲解Java注解生命周期', link: '/doc/Java/注解' },
                { text: '源码解析 ThreadLocal', link: '/doc/Java/源码解析ThreadLocal' },
                { text: 'Java 与 Kotlin 中的泛型', link: '/doc/Java/泛型' },
                { text: 'Java 集合 - Set', link: '/doc/Java/Java集合_Set' },
                { text: 'Java 集合 - Map', link: '/doc/Java/Java集合_Map' },
                { text: 'Java 集合 - List', link: '/doc/Java/Java集合_List' },
                { text: 'Java反射', link: '/doc/Java/Java反射' },
                { text: 'Exception与Error', link: '/doc/Java/Exception_Error' },
              ]
            },
            {
              text: 'Android',
              collapsed: true,
              items: [
                { text: "性能优化-编译优化", link: '/doc/Android/Gradle编译优化'},
                { text: "Gradle 分功能打包", link: '/doc/Android/Gradle_分功能打包'},
                { text: "探索 WebView 加载优化", link: '/doc/Android/WebView加载优化'},
                { text: "RecycerView 有效曝光埋点实现方案", link: '/doc/Android/RecyclerView有效曝光'},
                { text: "【源码解读】源解 Glide - 图片缓存", link: '/doc/Android/源解Glide_图片缓存'},
                { text: "【源码解读】源解 Glide - 监听者", link: '/doc/Android/源解Glide_监听者'},
                { text: "【源码解读】源解 Glide - 网络图片加载流程", link: '/doc/Android/源解Glide_加载流程'},
                { text: "性能优化-电量优化", link: '/doc/Android/电量优化'}
              ]
            },
          ]
        },
        {
          text: '开发总结',
          collapsed: true,
          items: [
            { text: "Gradle 分功能打包", link: '/doc/Android/Gradle_分功能打包'},
            { text: "探索 WebView 加载优化", link: '/doc/Android/WebView加载优化'},
            { text: "RecycerView 有效曝光埋点实现方案", link: '/doc/Android/RecyclerView有效曝光'}
          ]
        },
        {
          text: '总结与笔记',
          items: [
            {
              text: '总结与思考',
              collapsed: true,
              items: [
                { text: '清华公开课:商业模式的逻辑', link: '/doc/ThinkSummary/清华-商业模式的逻辑' },
                { text: '人工智能与大语言模型科普文', link: '/doc/ThinkSummary/人工智能与大语言模型科普文' },
              ]
            },
            {
              text: '读书笔记',
              collapsed: true,
              items: [
                { text: '《深入理解Kotlin协程》', link: '/doc/ThinkSummary/深入理解Kotlin协程'},
                { text: '《横向领导力》', link: '/doc/ThinkSummary/横向领导力'},
                { text: '《重构—改善既有代码的设计》', link: '/doc/ThinkSummary/重构-改善既有代码的设计'},
                { text: '《软技能—代码之外的生存指南》', link: '/doc/ThinkSummary/软技能—代码之外的生存指南'}
              ]
            }
          ]
        },
        
      ]
    },

    //本地搜索
    search: { 
      provider: 'local'
    }, 

    //社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/StefanShan' } 
    ],

    //页脚
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2019-present Evan You'
    },

    //右侧大纲
    outline: { 
      level: [1,4], // 显示2-4级标题
      // level: 'deep', // 显示2-6级标题
      label: '文章大纲' // 文字显示
    },

    //自定义上下页名
    docFooter: { 
      prev: '上一页', 
      next: '下一页', 
    }, 
  }
})
