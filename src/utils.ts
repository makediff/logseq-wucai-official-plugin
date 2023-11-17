import React, { useState } from 'react'
import { useMountedState } from 'react-use'
import { format } from 'date-fns'

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
}

export { WuCaiUtils }
