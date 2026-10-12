import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./EditorPage.desktop'), () => import('./EditorPage.mobile'))
