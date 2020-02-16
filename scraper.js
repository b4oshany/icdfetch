const fse = require('fs-extra');
const puppeteer = require("puppeteer");

var categories;
var diseases;

async function openCategories() {
    try {
        categories = await fse.readJson('./categories.json');
    } catch (err) {
        categories = {};
    }
}

async function openDiseases() {
    try {
        diseases = await fse.readJson('./icd11.json');
    } catch (err) {
        diseases = {
            'count': 0,
            'captured': [],
            'data': {}
        }
    }
}

function getDomPath(el) {
  if (!el) {
    return;
  }
  var stack = [];
  var isShadow = false;
  while (el.parentNode != null) {
    // console.log(el.nodeName);
    var sibCount = 0;
    var sibIndex = 0;
    // get sibling indexes
    for ( var i = 0; i < el.parentNode.childNodes.length; i++ ) {
      var sib = el.parentNode.childNodes[i];
      if ( sib.nodeName == el.nodeName ) {
        if ( sib === el ) {
          sibIndex = sibCount;
        }
        sibCount++;
      }
    }
    // if ( el.hasAttribute('id') && el.id != '' ) { no id shortcuts, ids are not unique in shadowDom
    //   stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
    // } else
    var nodeName = el.nodeName.toLowerCase();
    if (isShadow) {
      nodeName += "::shadow";
      isShadow = false;
    }
    if ( sibCount > 1 ) {
      stack.unshift(nodeName + ':nth-of-type(' + (sibIndex + 1) + ')');
    } else {
      stack.unshift(nodeName);
    }
    el = el.parentNode;
    if (el.nodeType === 11) { // for shadow dom, we
      isShadow = true;
      el = el.host;
    }
  }
  stack.splice(0,1); // removes the html element
  return stack.join(' > ');
}

async function savePage(page, filename) {
    let bodyHandle = await page.$('body');
    let html = await page.evaluate(body => body.innerHTML, bodyHandle);
    fse.outputFile(filename, html);
    console.log("Output file to " + filename);
}

async function saveDataAsJSON(data, filename) {
    fse.writeJson(filename, data, err => {
      if (err) return console.error(err)
    
      console.log('Write to file (' + filename + ') success!');
    });
    // fse.outputFile('filename', JSON.stringify(data));
    // console.log("Output file to " + filename);
}

async function open_tree({page, root, root_id, cat_id=null}) {
    var label_txt = await get_label(page, root);
    var num_objs = Object.keys(diseases['data']).length;
    if (num_objs > 0 && num_objs % 10 == 0) {
        await saveDataAsJSON(diseases, 'icd11.json');
    }
    console.log("Cat IS: " +  cat_id +  " Item " + Object.keys(diseases['data']).length + " ===> Tree -> " + label_txt);
    var has_dropdown = await page.evaluate(
        el => el ? true : false,
        await root.$('table td a.ygtvspacer:not(.adopted)')
    );
    if (has_dropdown) {
        var has_children = await page.evaluate(
            el => el ? true : false,
            await root.$('.ygtvchildren div.ygtvitem')
        );
        
        if (!has_children) {
            await page.evaluate(
                el => el.click(),
                await root.$('table td a.ygtvspacer')
            );
            // await page.waitFor(root_path + ' .ygtvchildren div.ygtvitem');
            await page.waitFor(2000);
        }
        var children = await root.$$('.ygtvchildren div.ygtvitem');
        var child_id;
        for (let child of children) {
            child_id = await save_disease(page, child, root_id, cat_id)
            if (child_id != null) {
                await open_tree({
                    page:page,
                    root:child,
                    root_id:child_id,
                    cat_id:cat_id
                });
            }
        }
    }
}

function isFunction(functionToCheck) {
 return functionToCheck && {}.toString.call(functionToCheck) === '[object Function]';
}

async function get_sub_label(page, label, fn) {
    var sub_label = await label.$('table .ygtvcontent a.ygtvlabel');
    var id_el = (await page.evaluate(el => el ? el.innerText : '', await sub_label.$('.icode'))).trim();
    if (fn) {
        return await fn(page, sub_label, id_el)
    }
    return id_el
}

async function get_label(page, label) {
    return (await page.evaluate(el => el.innerText, await label)).trim();
}

async function save_disease(page, label, id_el, cat_id) {
    var sub_label = await label.$('table .ygtvcontent a.ygtvlabel:not(.adopted)');
    if (sub_label == null) {
        return false;
    }
    var id_el = (await page.evaluate(el => el ? el.innerText : '', await sub_label.$('.icode'))).trim();
    var result = await get_label(page, sub_label);
    if (id_el) {
        diseases['data'][id_el] = {
            'title': result,
            'theCode': id_el,
            'chapter': cat_id
        };
        diseases['count'] = Object.keys(diseases['data']).length;
        
    }
    return result
}

async function save_categories(page, label, id_el) {
    categories[
        id_el
    ] = await get_label(page, label);
    return id_el;
}

async function process_category(page, category_el) {
    var id_el = await get_sub_label(page, category_el, save_categories);
    if (diseases['captured'].indexOf(id_el) != -1) {
        return;
    }
    await open_tree({
        page:page,
        root:category_el,
        root_id:id_el,
        cat_id:id_el
    });
        
    if (diseases['captured'].indexOf(id_el) == -1) {
        diseases['captured'].push(id_el);
    } else {
        diseases['captured'] = [...new Set(diseases['captured'])]
    }
    await saveDataAsJSON(categories, 'categories.json');
    await saveDataAsJSON(diseases, 'icd11.json');
}

async function run() {

    await openCategories();
    await openDiseases();

    const browser = await puppeteer.launch();

    const page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.goto('https://icd.who.int/browse11/l-m/en#/');
    
    await page.waitFor('#ygtvtableel1',  3000);
    var icd11_el = await page.$('#ygtvtableel1');
    icd11_el.click();
    
    await page.waitFor('#ygtvc1 div.ygtvitem',  3000);
    
    var icd11_cats = await page.$$('#ygtvc1 > div.ygtvitem');
    
    await page.exposeFunction('getDomPath', (el) => {
        console.log(el);
        return getDomPath(el);
     });
    
    for (let cat of icd11_cats) {
        await process_category(page, cat);
    }
    
    await savePage(page, 'page.html')
    await page.screenshot({path: 'page.png'});
    await browser.close();
}

run();
