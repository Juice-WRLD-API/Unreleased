import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./DocsPage.desktop'), () => import('./DocsPage.mobile'))
