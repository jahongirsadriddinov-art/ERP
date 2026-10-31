// three.js (AI ofis sahnasi) JSX teglari — `<mesh>`, `<group>`,
// `<meshStandardMaterial>` va boshqalar.
//
// @react-three/fiber v8 ularni ESKI joyga — global `JSX.IntrinsicElements`ga
// qo'shadi. Bu loyihada esa @types/react 19 ishlatiladi, u JSX'ni
// `React.JSX`ga ko'chirgan (global `JSX` nomlar maydoni yo'q), shuning uchun
// o'sha qo'shimcha HISOBGA OLINMASDI: tekshiruv 400dan ortiq
// "Property 'mesh' does not exist on type 'JSX.IntrinsicElements'" berardi.
// Shu ko'prik ikkisini bog'laydi — boshqa hech narsani o'zgartirmaydi.
import type { ThreeElements } from '@react-three/fiber'

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements extends ThreeElements {}
    }
  }
}
