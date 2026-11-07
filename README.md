# [NeurIPS 2026] PPG2ECG: Physiology-Guided Latent Rectified Flow for Electro-Hemodynamic PPG-to-ECG Generation

Xiaoda Wang, Minxiao Wang, Kaiqiao Han, Defu Cao, Ching Chang, Yidan Shi, Runze Yan, Xiao Luo, Yan Liu, Xiao Hu, Yizhou Sun, Wei Wang, Carl Yang

Emory University · University of California, Los Angeles · University of Southern California · University of Wisconsin–Madison

## Overview

PPG2ECG is a physiology-guided latent rectified flow framework for generating ECG from PPG.
It introduces an electro-hemodynamic simulator that co-models ECG and PPG through shared cardiac phase dynamics.
Guided by this simulator, a Physiology-Aware AutoEncoder learns a structured electro-hemodynamic latent space,
and a PPG-conditioned latent rectified flow generates ECG in that space while enforcing ECG-side morphology consistency
and ECG-to-PPG forward hemodynamic consistency.
Experiments on the large-scale MC-MED dataset show improved PPG-to-ECG generation and downstream cardiovascular disease classification.

## Release Status

- [ ] Paper link
- [ ] Code
- [ ] Pretrained model parameters

## Model Parameters

Pretrained model parameters are available upon request.
Please email xiaoda.wang@emory.edu and briefly describe your intended use.

## Citation

If you find our work useful in your study, please cite:

```bibtex
@inproceedings{wang2026ppg2ecg,
  title={PPG2ECG: Physiology-Guided Latent Rectified Flow for Electro-Hemodynamic PPG-to-ECG Generation},
  author={Wang, Xiaoda and Wang, Minxiao and Han, Kaiqiao and Cao, Defu and Chang, Ching and Shi, Yidan and Yan, Runze and Luo, Xiao and Liu, Yan and Hu, Xiao and Sun, Yizhou and Wang, Wei and Yang, Carl},
  booktitle={The Fortieth Annual Conference on Neural Information Processing Systems},
  year={2026}
}
```
