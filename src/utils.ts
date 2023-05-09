import React, { useState } from 'react'
import { useMountedState } from 'react-use'

class WuCaiUtils {
  static splitStringAndTrimEmptyLine(coretxt: string): Array<string> {
    if (!coretxt || coretxt.length <= 0) {
      return []
    }
    let arrCore = coretxt.split('\n')
    let ret = []
    for (let i2 = 0; i2 < arrCore.length; i2++) {
      let _s2 = arrCore[i2]
        .replace(/[\s\t]+/, ' ')
        .replace(/[\r\n]+/g, '')
        .trim()
      if (_s2.length > 0) {
        ret.push(_s2)
      }
    }
    return ret
  }

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
}

export { WuCaiUtils }
