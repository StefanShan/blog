import { defineConfig } from 'vitepress'
import timeline from "vitepress-markdown-timeline"; 

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "青杉的博客",
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
      // 'Java': [
      //   {
      //     text: 'Java',
      //     collapsed: true,
      //     items: [
      //       { text: 'Index', link: '/Java/' },
      //       { text: 'test', link: '/Java/test' },
      //       { text: 'Two', link: '/Java/two' }
      //     ]
      //   }
      // ],
      // 'Android': [
      //   {
      //     text: 'Android',
      //     collapsed: false,
      //     items: [
      //       { text: 'Index', link: '/Android/' },
      //       { text: 'test', link: '/Android/test' },
      //       { text: 'Two', link: '/Android/two' }
      //     ]
      //   }
      // ]
    },

    //本地搜索
    search: { 
      provider: 'local'
    }, 

    //社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' } 
    ],

    //页脚
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2019-present Evan You'
    },

    //右侧大纲
    outline: { 
      level: [2,4], // 显示2-4级标题
      // level: 'deep', // 显示2-6级标题
      label: '当前页大纲' // 文字显示
    },

    //自定义上下页名
    docFooter: { 
      prev: '上一页', 
      next: '下一页', 
    }, 
  }
})
