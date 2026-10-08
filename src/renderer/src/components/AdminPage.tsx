import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./AdminPage.desktop'), () => import('./AdminPage.mobile'))
