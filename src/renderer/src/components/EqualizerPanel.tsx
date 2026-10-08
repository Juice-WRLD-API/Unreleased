import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./EqualizerPanel.desktop'), () => import('./EqualizerPanel.mobile'))
