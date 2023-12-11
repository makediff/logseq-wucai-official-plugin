import React, { useState } from 'react'
import { useMountedState } from 'react-use'
import { format } from 'date-fns'
import Mustache from 'Mustache'
Mustache.escape = function (text) { return text; }

class WuCaiUtils {
  static useAppVisible() {
    const [visible, setVisible] = useState(logseq.isMainUIVisible)
    const isMounted = useMountedState()
    React.useEffect(() => {
      const eventName = 'ui:visible:changed'
      const handler = async ({ visible }: any) => {
        if (isMounted()) {
          setVisible(visible)
        }
      }
      logseq.on(eventName, handler)
      return () => {
        logseq.off(eventName, handler)
      }
    }, [])
    return visible
  }

  static escapeQuotes(s: string): string {
    return s.replace(/"/g, '\\"')
  }

  static formatTitle(s: string): string {
    s = s || ''
    s = s.replace(/^\s+|\s+$/, '')
    return s
  }

  static formatContent(s: string): string {
    // 因为logseq里的block不允许有 head
    s = s || ''
    s = s.replace(/^\s+|\s+$/, '') // 因为logseq会自动的去空格，是为了保持一致
    return s.replace(/#\s+/g, '#')
  }

  static generatePageName(titleTemplate: string, createat: number): string {
    let ds = new Date(createat * 1000)
    const prefix = 'WuCaiHighlights-'
    if ('one' == titleTemplate) {
      return 'WuCaiHighlights'
    } else if ('week' == titleTemplate) {
      return prefix + format(ds, 'yyyy-MM') + '-W' + format(ds, 'w')
    } else if ('year' == titleTemplate) {
      return prefix + format(ds, 'yyyy')
    } else if ('month' == titleTemplate) {
      return prefix + format(ds, 'yyyyMM')
    } else if ('quarter' == titleTemplate) {
      return prefix + format(ds, 'yyyyQQQ')
    }
    return prefix + format(ds, 'yyyy-MM')
  }

  static renderTemplate(tpl: string, view: any): string {
    return Mustache.render(tpl, view)
  }

  static preParser(t: AttrsItem) {
    if (t && t.value && t.value.indexOf("{{") >= 0) {
      t.render = true
      Mustache.parse(t.value)
    }
  }

  static preParserTemplate(tpl: WuCaiTemplates) {
    if (!tpl) {
      return {}
    }
    if (tpl.AttrTemplate) {
      for (let t of tpl.AttrTemplate) {
        this.preParser(t)
      }
    }
    if (tpl.HighlightTemplate) {
      this.preParser(tpl.HighlightTemplate)
    }
    if (tpl.AnnoTemplate) {
      this.preParser(tpl.AnnoTemplate)
    }
    if (tpl.TitleTemplate) {
      this.preParser(tpl.TitleTemplate)
    }
    return {}
  }

  static parserAttrTemplate(attrTemplate: string): Array<AttrsItem> {
    attrTemplate = attrTemplate || ''
    if (!attrTemplate) {
      return []
    }
    let arrTemp = attrTemplate.split("\n")
    let names: { [key: string]: number } = {}
    let attrs: Array<AttrsItem> = []
    for (let line of arrTemp) {
      line = line.trim()
      let attrIdx = line.indexOf("::")
      if (!line || attrIdx <= 0 || line.indexOf("#") === 0) {
        continue
      }
      let name = line.substring(0, attrIdx).trim()
      let value = line.substring(attrIdx + 2).trim()
      if (!name || !value || 'noteid' === name) {
        continue
      }
      if (names[name] === undefined) {
        attrs.push({ name, value, render: false })
      }
      names[name] = 1
    }
    return attrs
  }

  static getHighlightUrl(entryUrl: string, refurl: string): string {
    if (!entryUrl || entryUrl.length <= 0) {
      return ''
    }
    if (!refurl || refurl.length <= 0) {
      return entryUrl || ''
    }
    entryUrl = entryUrl.replace(/#+$/, '')
    let idx = entryUrl.indexOf('#')
    if (idx >= 0) {
      return entryUrl
    }
    return entryUrl + refurl
  }
}

export { WuCaiUtils }
