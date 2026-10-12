import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./EditorProfileView.desktop'), () => import('./EditorProfileView.mobile'))
