import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CLASS_ICON_DATA_URI,
  CLASS_ICON_FEMALE_DATA_URI,
  Gender,
} from '../../core/data/class-icons.data';
import { getClassName } from '../../core/data/class-names.data';
import { CLASS_PORTRAIT_ORDER } from '../../core/data/class-portraits.data';
import { ClassPickerMode, ClassPickerService } from '../../core/services/class-picker.service';
import { AppLocale, I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../translate.pipe';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { ClassPortraitComponent } from '../class-portrait/class-portrait.component';

export interface ClassPickerPosition {
  name: string | null;
  x: number;
  y: number;
}

interface ClassOption {
  key: string;
  label: string;
  icon: string;
}

// Même ordre que la grille "Avatar" du profil (CLASS_PORTRAIT_ORDER) plutôt qu'un tri
// alphabétique par clé interne — cohérence visuelle entre les deux endroits où l'utilisateur
// parcourt les 18 classes. Indépendant de la locale : trier par libellé localisé mélangerait
// l'agencement de la grille à chaque changement de langue — voir class-names.data.ts pour les
// libellés eux-mêmes, très différents d'une langue à l'autre.
const CLASS_KEYS = CLASS_PORTRAIT_ORDER;
const ICON_MAPS: Record<Gender, Readonly<Record<string, string>>> = {
  m: CLASS_ICON_DATA_URI,
  f: CLASS_ICON_FEMALE_DATA_URI,
};

function buildOptions(gender: Gender, locale: AppLocale): ClassOption[] {
  const icons = ICON_MAPS[gender];
  return CLASS_KEYS.map((key) => ({
    key,
    label: getClassName(key, locale),
    icon: icons[key],
  }));
}

/**
 * Petit menu de sélection de classe (par image), positionné au point de
 * clic. Réutilisé partout où un allié dont la classe n'a pas été détectée
 * automatiquement peut se voir assigner une classe manuellement.
 */
@Component({
  selector: 'app-class-picker',
  imports: [TranslatePipe, TooltipDirective, ClassPortraitComponent],
  templateUrl: './class-picker.component.html',
  styleUrl: './class-picker.component.css',
})
export class ClassPickerComponent implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly classPickerService = inject(ClassPickerService);

  readonly position = input.required<ClassPickerPosition>();
  /** Mode d'affichage à l'ouverture — l'utilisateur peut ensuite basculer librement via le switch
   * du picker (voir `mode`/`setMode` ci-dessous). */
  readonly initialMode = input<ClassPickerMode>('icons');
  readonly switchModeBlocked = input<boolean>(false);
  readonly classChosen = output<{ className: string; gender: Gender }>();
  readonly closed = output<void>();

  /** Sexe des icônes affichées — également transmis dans `classChosen` pour
   * que l'entité choisie affiche ensuite une icône du même sexe partout
   * (combat, historique, récap, expérience). */
  protected readonly gender = signal<Gender>('m');
  protected readonly classOptions = computed(() => buildOptions(this.gender(), this.i18n.locale()));

  /** 'icons' : grille compacte d'icônes carrées (comportement historique, adapté à un menu
   * contextuel rapide). 'portraits' : grille de portraits "grand format" Ankama (planche
   * `class-portraits.data.ts`, encyclopédie officielle — bien plus détaillée que les icônes) pour
   * un choix "posé" comme la création d'un personnage — voir `app-character-add-form`. */
  protected readonly mode = signal<ClassPickerMode>('icons');

  private readonly pickerEl = viewChild<ElementRef<HTMLDivElement>>('picker');
  /** Position affichée, recalée pour ne jamais déborder du viewport (le clic
   * droit d'origine peut arriver près du bord droit/bas de l'écran, la
   * largeur du menu — 6 colonnes fixes — dépassant alors l'écran). Mesurée
   * via ResizeObserver plutôt qu'une seule lecture d'`offsetWidth` dans
   * l'effet : au tout premier passage, la grille CSS (icônes) n'a pas encore
   * fini son layout (largeur transitoire ~52px au lieu des ~256px finaux),
   * ce qui donnait un calcul de bord faux — le ResizeObserver se déclenche à
   * nouveau une fois la taille réelle atteinte et corrige la position. */
  protected readonly displayPosition = signal({ left: 0, top: 0 });
  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      this.position();
      this.mode.set(this.initialMode());
      const el = this.pickerEl()?.nativeElement;
      this.resizeObserver?.disconnect();
      if (!el) return;
      this.resizeObserver = new ResizeObserver(() => this.updateDisplayPosition(el));
      this.resizeObserver.observe(el);
      this.updateDisplayPosition(el);
    });
  }

  private updateDisplayPosition(el: HTMLElement): void {
    const pos = this.position();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
    this.displayPosition.set({
      left: Math.min(pos.x, maxLeft),
      top: Math.min(pos.y, maxTop),
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected setGender(gender: Gender): void {
    this.gender.set(gender);
  }

  protected setMode(mode: ClassPickerMode): void {
    this.mode.set(mode);
    // Le choix de l'utilisateur (icônes/portraits) vaut préférence générale, pas seulement pour ce
    // picker précis — voir ClassPickerService.preferredMode, repris comme `initialMode` par défaut
    // à la prochaine ouverture (tous appelants confondus, sauf ceux forçant un mode explicite).
    this.classPickerService.setPreferredMode(mode);
  }

  protected choose(className: string): void {
    this.classChosen.emit({ className, gender: this.gender() });
  }

  protected close(): void {
    this.closed.emit();
  }
}
