/**
 * 랜딩 페이지 JavaScript
 * 부드러운 스크롤 및 애니메이션 효과를 담당합니다.
 */

// 부드러운 스크롤
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetElement = document.querySelector(this.getAttribute('href'));
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// 스크롤 애니메이션
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in');
        }
    });
}, observerOptions);

// 카드 요소들에 옵저버 적용
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.card-hover').forEach(card => {
        observer.observe(card);
    });
});