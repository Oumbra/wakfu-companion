import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export type BrowserKind = 'chrome' | 'edge' | 'opera';

let nextUid = 0;

/**
 * Logos officiels (Chrome/Edge/Opera) dessinés en SVG à la main dans le
 * composant — voir principe d'architecture n°1 (CLAUDE.md) : rien
 * d'externe ne doit fuiter dans le build standalone, donc pas d'image
 * chargée depuis un CDN de logos. Les identifiants de dégradé de chaque
 * SVG sont suffixés par un id d'instance unique (`uid`) pour éviter toute
 * collision si plusieurs badges du même navigateur sont rendus en même
 * temps sur la page (les `id` SVG sont globaux au document).
 */
const BROWSER_SVG: Record<BrowserKind, (uid: string) => string> = {
  chrome: (uid) =>
    `<svg viewBox="-10 -10 276 276" width="100%" height="100%"><linearGradient id="a${uid}" x1="145" x2="34" y1="253" y2="61" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1e8e3e"/><stop offset="1" stop-color="#34a853"/></linearGradient><linearGradient id="b${uid}" x1="111" x2="222" y1="254" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fcc934"/><stop offset="1" stop-color="#fbbc04"/></linearGradient><linearGradient id="c${uid}" x1="17" x2="239" y1="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#d93025"/><stop offset="1" stop-color="#ea4335"/></linearGradient><circle cx="128" cy="128" r="64" fill="#fff"/><path fill="url(#a${uid})" d="M96 183.4A63.7 63.7 0 0 1 72.6 160L17.2 64A128 128 0 0 0 128 256l55.4-96A64 64 0 0 1 96 183.4Z"/><path fill="url(#b${uid})" d="M192 128a63.7 63.7 0 0 1-8.6 32L128 256A128 128 0 0 0 238.9 64h-111a64 64 0 0 1 64 64Z"/><circle cx="128" cy="128" r="52" fill="#1a73e8"/><path fill="url(#c${uid})" d="M96 72.6a63.7 63.7 0 0 1 32-8.6h110.8a128 128 0 0 0-221.7 0l55.5 96A64 64 0 0 1 96 72.6Z"/></svg>`,
  edge: (uid) =>
    `<svg viewBox="0 0 27600 27600" width="100%" height="100%" xmlns:xlink="http://www.w3.org/1999/xlink"><linearGradient id="a${uid}" gradientUnits="userSpaceOnUse"/><linearGradient id="b${uid}" x1="6870" x2="24704" y1="18705" y2="18705" href="#a${uid}" xlink:href="#a${uid}"><stop offset="0" stop-color="#0c59a4"/><stop offset="1" stop-color="#114a8b"/></linearGradient><linearGradient id="c${uid}" x1="16272" x2="5133" y1="10968" y2="23102" href="#a${uid}" xlink:href="#a${uid}"><stop offset="0" stop-color="#1b9de2"/><stop offset=".16" stop-color="#1595df"/><stop offset=".67" stop-color="#0680d7"/><stop offset="1" stop-color="#0078d4"/></linearGradient><radialGradient id="d${uid}" cx="16720" cy="18747" r="9538" href="#a${uid}" xlink:href="#a${uid}"><stop offset=".72" stop-opacity="0"/><stop offset=".95" stop-opacity=".53"/><stop offset="1"/></radialGradient><radialGradient id="e${uid}" cx="7130" cy="19866" r="14324" gradientTransform="matrix(.14843 -.98892 .79688 .1196 -8759 25542)" href="#a${uid}" xlink:href="#a${uid}"><stop offset=".76" stop-opacity="0"/><stop offset=".95" stop-opacity=".5"/><stop offset="1"/></radialGradient><radialGradient id="f${uid}" cx="2523" cy="4680" r="20243" gradientTransform="matrix(-.03715 .99931 -2.12836 -.07913 13579 3530)" href="#a${uid}" xlink:href="#a${uid}"><stop offset="0" stop-color="#35c1f1"/><stop offset=".11" stop-color="#34c1ed"/><stop offset=".23" stop-color="#2fc2df"/><stop offset=".31" stop-color="#2bc3d2"/><stop offset=".67" stop-color="#36c752"/></radialGradient><radialGradient id="g${uid}" cx="24247" cy="7758" r="9734" gradientTransform="matrix(.28109 .95968 -.78353 .22949 24510 -16292)" href="#a${uid}" xlink:href="#a${uid}"><stop offset="0" stop-color="#66eb6e"/><stop offset="1" stop-color="#66eb6e" stop-opacity="0"/></radialGradient><path id="h${uid}" d="M24105 20053a9345 9345 0 01-1053 472 10202 10202 0 01-3590 646c-4732 0-8855-3255-8855-7432 0-1175 680-2193 1643-2729-4280 180-5380 4640-5380 7253 0 7387 6810 8137 8276 8137 791 0 1984-230 2704-456l130-44a12834 12834 0 006660-5282c220-350-168-757-535-565z"/><path id="i${uid}" d="M11571 25141a7913 7913 0 01-2273-2137 8145 8145 0 01-1514-4740 8093 8093 0 013093-6395 8082 8082 0 011373-859c312-148 846-414 1554-404a3236 3236 0 012569 1297 3184 3184 0 01636 1866c0-21 2446-7960-8005-7960-4390 0-8004 4166-8004 7820 0 2319 538 4170 1212 5604a12833 12833 0 007684 6757 12795 12795 0 003908 610c1414 0 2774-233 4045-656a7575 7575 0 01-6278-803z"/><path id="j${uid}" d="M16231 15886c-80 105-330 250-330 566 0 260 170 512 472 723 1438 1003 4149 868 4156 868a5954 5954 0 003027-839 6147 6147 0 001133-850 6180 6180 0 001910-4437c26-2242-796-3732-1133-4392-2120-4141-6694-6525-11668-6525-7011 0-12703 5635-12798 12620 47-3654 3679-6605 7996-6605 350 0 2346 34 4200 1007 1634 858 2490 1894 3086 2921 618 1067 728 2415 728 2952s-271 1333-780 1990z"/><use fill="url(#b${uid})" href="#h${uid}" xlink:href="#h${uid}"/><use fill="url(#d${uid})" opacity=".35" href="#h${uid}" xlink:href="#h${uid}"/><use fill="url(#c${uid})" href="#i${uid}" xlink:href="#i${uid}"/><use fill="url(#e${uid})" opacity=".4" href="#i${uid}" xlink:href="#i${uid}"/><use fill="url(#f${uid})" href="#j${uid}" xlink:href="#j${uid}"/><use fill="url(#g${uid})" href="#j${uid}" xlink:href="#j${uid}"/></svg>`,
  opera: (uid) =>
    `<svg viewBox="0 0 1090 1090" width="100%" height="100%"><linearGradient id="a${uid}" x1="461" x2="461" y1="59" y2="1033" gradientUnits="userSpaceOnUse"><stop offset=".6" stop-color="#ff1b2d"/><stop offset="1" stop-color="#a70014"/></linearGradient><linearGradient id="b${uid}" x1="714" x2="714" y1="116" y2="978" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9c0000"/><stop offset=".7" stop-color="#ff4b4b"/></linearGradient><path fill="url(#a${uid})" d="M545 42.5a502.5 502.5 0 10334.9 877.1 362.4 362.4 0 01-201.4 61.5c-119.7 0-226.8-59.4-299-153-55.6-65.6-91.5-162.5-94-271.3V533c2.5-108.8 38.4-205.8 94-271.3 72-93.6 179.3-153 299-153 73.6 0 142.5 22.5 201.4 61.6a500.8 500.8 0 00-333-127.9h-2z"/><path fill="url(#b${uid})" d="M379.6 261.8c46-54.4 105.7-87.3 170.7-87.3 146.3 0 265 166 265 370.4 0 204.6-118.6 370.4-265 370.4-65 0-124.6-32.8-170.7-87.2 72 93.6 179.2 153 299 153A363 363 0 00880 919.6 501 501 0 001047.5 545a501.1 501.1 0 00-167.6-374.6 362.4 362.4 0 00-201.4-61.5c-119.7 0-226.8 59.4-299 153"/></svg>`,
};

@Component({
  selector: 'app-browser-icon',
  template: `<span class="browser-badge" [innerHTML]="svg()"></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .browser-badge {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
})
export class BrowserIconComponent {
  readonly kind = input.required<BrowserKind>();

  private readonly uid = `-bi${nextUid++}`;
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly svg = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(BROWSER_SVG[this.kind()](this.uid)),
  );
}
