
const LOGO_URL = 'https://imssbienestar.gob.mx/assets/img/imb_b.svg';

import { Map, MapPin } from 'lucide-react';

export type AppSection = 'mapa' | 'propuestas';

export function Header({
  activeSection,
  onSectionChange,
  onLogoClick,
  onLogoDoubleClick,
}: {
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
  onLogoClick?: () => void;
  onLogoDoubleClick?: () => void;
}) {

  return (
    <>
      <nav className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_URL}
              alt="IMSS Bienestar"
              onClick={onLogoClick}
              onDoubleClick={onLogoDoubleClick}
              className="h-9 w-auto cursor-pointer brightness-0 saturate-100 [filter:invert(10%)_sepia(79%)_saturate(665%)_hue-rotate(120deg)_brightness(41%)_contrast(104%)]" style={{ userSelect: 'none' }}
            />
            <div className="leading-none">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Gobierno de Mexico</p>
              <p className="text-sm font-bold tracking-tight text-imss-green">IMSS Bienestar</p>
            </div>
          </div>

          <div className="flex items-center gap-1" role="tablist" aria-label="Secciones principales">
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === 'mapa'}
              onClick={() => onSectionChange('mapa')}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeSection === 'mapa' ? 'bg-emerald-50 text-imss-green' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            >
              <Map className="h-4 w-4" />
              <span className="hidden sm:inline">Mapa</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === 'propuestas'}
              onClick={() => onSectionChange('propuestas')}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeSection === 'propuestas' ? 'bg-emerald-50 text-imss-green' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            >
              <MapPin className="h-4 w-4" />
              <span>Formulario</span>
            </button>
          </div>
        </div>
      </nav>

      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-tight text-imss-green sm:text-4xl lg:text-5xl">
            {activeSection === 'mapa' ? 'Mapa de Primer Nivel IMO, IMB y CSA' : 'Propuesta de nueva unidad'}
          </h1>
          <p className="mt-2 max-w-xl text-base text-gray-500">
            {activeSection === 'mapa'
              ? 'Consulta y localiza unidades de primer nivel por CLUES, nombre e institución.'
              : 'Ubica y registra una opción para IMO, IMB o CSA.'}
          </p>
        </div>
      </div>
    </>
  );
}
