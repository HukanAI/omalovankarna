<script lang="ts"></script>

<!--
  Úvodní ilustrace: fotka vzadu, před ní list s tou samou scénou jako kresbou,
  kterou někdo začal vybarvovat. Vše kreslené tuší a pastelkou.
-->
<svg viewBox="0 0 320 210" class="art" aria-hidden="true">
  <defs>
    <clipPath id="ha-sheet"><rect x="0" y="0" width="150" height="112" rx="3" /></clipPath>
    <pattern id="ha-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <rect width="6" height="6" fill="var(--crayon)" opacity=".85" />
      <path d="M0 0v6" stroke="#fff" stroke-width="1.3" opacity=".25" />
    </pattern>
    <pattern id="ha-hatch2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <rect width="6" height="6" fill="var(--ochre)" opacity=".85" />
      <path d="M0 0v6" stroke="#fff" stroke-width="1.3" opacity=".3" />
    </pattern>
  </defs>

  <!-- fotka -->
  <g transform="translate(36 34) rotate(-7)">
    <rect x="-8" y="-8" width="166" height="148" rx="4" fill="#fffdf8" class="shadow" />
    <rect x="0" y="0" width="150" height="112" rx="2" fill="#a9c7dd" />
    <circle cx="112" cy="30" r="14" fill="#f4c35b" />
    <path d="M0 80 C30 62 60 64 88 76 S130 70 150 64 V112 H0z" fill="#8fb07a" />
    <path d="M36 76 l22-20 22 20 v24 h-44z" fill="#d86b4a" />
    <rect x="52" y="84" width="12" height="16" fill="#6b3b2a" />
  </g>

  <!-- list s kresbou -->
  <g transform="translate(142 46) rotate(5)">
    <rect x="-10" y="-10" width="170" height="150" rx="4" fill="#fffdf8" class="shadow" />
    <g clip-path="url(#ha-sheet)">
      <path d="M36 76 l22-20 22 20 v24 h-44z" fill="url(#ha-hatch)" class="colored" />
      <circle cx="112" cy="30" r="14" fill="url(#ha-hatch2)" class="colored2" />
    </g>
    <g fill="none" stroke="#1d1a17" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="lines">
      <circle cx="112" cy="30" r="14" />
      <path d="M112 8v-5 M112 57v-5 M90 30h-5 M139 30h-5" />
      <path d="M2 80 C30 62 60 64 88 76 S130 70 148 64" />
      <path d="M36 76 l22-20 22 20 v24 h-44z" />
      <path d="M52 100 v-16 h12 v16" />
      <path d="M10 104 q6-8 12 0 M118 98 q5-7 10 0" />
    </g>
  </g>

  <!-- pastelka -->
  <g transform="translate(250 150) rotate(-38)" class="pencil">
    <rect x="0" y="-7" width="62" height="14" rx="2" fill="var(--crayon)" />
    <rect x="0" y="-7" width="62" height="4" rx="2" fill="#fff" opacity=".22" />
    <path d="M0 -7 L-16 0 L0 7z" fill="#f2d6b4" />
    <path d="M-10 -2.6 L-16 0 L-10 2.6z" fill="var(--crayon)" />
    <rect x="56" y="-7" width="8" height="14" fill="#1d1a17" opacity=".85" />
  </g>
</svg>

<style>
  .art {
    width: 100%;
    max-width: 380px;
    height: auto;
    display: block;
    margin: 0 auto;
    overflow: visible;
  }
  .shadow {
    filter: drop-shadow(0 6px 10px rgb(70 45 20 / 0.22));
  }
  .lines path,
  .lines circle {
    stroke-dasharray: 400;
    stroke-dashoffset: 400;
    animation: draw 1.8s 0.2s var(--ease) forwards;
  }
  .colored,
  .colored2 {
    opacity: 0;
    animation: fade 0.8s 1.6s var(--ease) forwards;
  }
  .colored2 {
    animation-delay: 2s;
  }
  .pencil {
    animation: wiggle 2.4s 0.2s var(--ease) both;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes fade {
    to {
      opacity: 1;
    }
  }
  @keyframes wiggle {
    0% {
      transform: translate(250px, 150px) rotate(-38deg) translate(-40px, -30px);
    }
    60% {
      transform: translate(250px, 150px) rotate(-34deg) translate(-6px, 4px);
    }
    100% {
      transform: translate(250px, 150px) rotate(-38deg);
    }
  }
</style>
