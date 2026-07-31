<template>
  <main class="page auth-page">
    <section class="auth-shell">
      <slot />
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  display: flex;
  align-items: stretch;
  background: linear-gradient(170deg, #fff3e9 0%, #fbfaf8 58%);
}

.auth-shell {
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
</style>
