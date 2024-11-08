const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const puppeteer = require('puppeteer');
const app = express();

app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

const uri = "mongodb+srv://admin:qwer1234@cluster0.ikezm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const dbName = 'Cluster0';
let collection;

// MongoDB 연결
MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    console.log('MongoDB 연결 성공');
    const db = client.db(dbName);
    collection = db.collection('recipes02');

    app.listen(3000, () => {
      console.log('서버가 http://localhost:3000 에서 실행 중');
    });
  })
  .catch(error => console.error('MongoDB 연결 실패:', error));

// 레시피 크롤링 함수
async function scrapeRecipe(recipeId) {
  const url = `https://m.10000recipe.com/recipe/${recipeId}`;
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 메인 이미지 가져오기
    const mainImage = await page.$eval('.view3_pic_img img', img => img.src).catch(() => null);

    // 조리 순서와 이미지를 가져오기
    const steps = await page.$$eval('.step_list.st_thumb li', nodes => {
      return nodes.map(node => ({
        description: node.querySelector('.step_list_txt_cont') ? node.querySelector('.step_list_txt_cont').innerText.trim() : '',
        image: node.querySelector('.step_list_txt_pic img') ? node.querySelector('.step_list_txt_pic img').src : '기본이미지URL'
      }));
    }).catch(() => []);

    await browser.close();
    return { mainImage, steps };
  } catch (error) {
    console.error("레시피 크롤링 중 오류 발생:", error);
    await browser.close();
    return { mainImage: null, steps: [] };
  }
}

// 메인 페이지 (레시피 목록)
app.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 10;

  const totalRecipes = await collection.countDocuments();
  const totalPages = Math.ceil(totalRecipes / perPage);

  const recipes = await collection.find()
    .skip((page - 1) * perPage)
    .limit(perPage)
    .toArray();

  res.render('index', { recipes, currentPage: page, totalPages });
});

// 레시피 상세 페이지 라우트
app.get('/recipe/:id', async (req, res) => {
  const recipeId = req.params.id;

  try {
    const recipe = await collection.findOne({ RCP_SNO: parseInt(recipeId) });
    
    if (recipe) {
      // 조리 순서와 이미지 크롤링
      const { mainImage, steps } = await scrapeRecipe(recipeId);

      res.render('recipe', {
        recipe,
        mainImage,
        steps
      });
    } else {
      res.status(404).send('레시피를 찾을 수 없습니다.');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('서버 오류가 발생했습니다.');
  }
});

// 검색 라우트
app.get('/search', async (req, res) => {
  const userInput = req.query.ingredients;
  const userIngredients = userInput.split(',').map(item => item.trim()); // 입력한 재료를 쉼표로 분리

  try {
    const recipes = await collection.find().toArray(); // 모든 레시피 가져오기

    // 각 레시피에 대해 일치율 계산
    const matchedRecipes = recipes.map(recipe => {
      const recipeIngredients = typeof recipe.CKG_MTRL_CN === 'string' 
        ? recipe.CKG_MTRL_CN.split('|').map(item => item.trim()) // 레시피 재료를 분리
        : [];

      const matchingIngredients = userIngredients.filter(ingredient => 
        recipeIngredients.includes(ingredient)
      );

      const matchPercentage = (matchingIngredients.length / recipeIngredients.length) * 100;

      const missingIngredients = recipeIngredients.filter(recipeIngredient => 
        !userIngredients.includes(recipeIngredient)
      );

      return {
        ...recipe,
        matchPercentage,
        missingIngredients
      };
    });

    // 일치율이 20% 이상인 레시피만 필터링
    const filteredRecipes = matchedRecipes.filter(recipe => recipe.matchPercentage >= 20);

    // 일치율이 높은 순서대로 정렬
    filteredRecipes.sort((a, b) => b.matchPercentage - a.matchPercentage);

    // 검색 결과를 렌더링
    res.render('searchResults', {
      userIngredients,
      recipes: filteredRecipes
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('검색 중 오류가 발생했습니다.');
  }
});
