import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./WordleView.desktop'), () => import('./WordleView.mobile'))
