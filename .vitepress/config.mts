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
      'KnowledgeRepo': [
        {
          text: 'Java',
          items: [
            { text: '注解生命周期', link: '/KnowledgeRepo/Java/注解' },
            { text: '源码解析 ThreadLocal', link: '/KnowledgeRepo/Java/源码解析ThreadLocal' },
            { text: 'Java 与 Kotlin 中的泛型', link: '/KnowledgeRepo/Java/泛型' },
            { text: 'Java 集合 - List', link: '/KnowledgeRepo/Java/Java集合_List' },
            { text: 'Java反射', link: '/KnowledgeRepo/Java/Java反射' },
            { text: 'Exception与Error', link: '/KnowledgeRepo/Java/Exception_Error' },
          ]
        },
        {
          text: 'Android',
          items: [
            { text: "探索 WebView 加载优化", link: '/KnowledgeRepo/Android/WebView加载优化'}
          ]
        }
      ],
      'ThinkSummary':[
        {text: '转载文章',
          items: [
            {text: '【转】万字干货揭秘出海APP成功秘诀：小团队和个人开发者的APP选品指南', link: '/ThinkSummary/揭秘出海APP成功秘诀-APP选品指南'}
          ]
        }
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
