# QrCode


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**qr** | **str** | QR code string | 
**expires_at** | **datetime** | QR code expiration | 
**message** | **str** | Status message | 

## Example

```python
from omni_generated.models.qr_code import QrCode

# TODO update the JSON string below
json = "{}"
# create an instance of QrCode from a JSON string
qr_code_instance = QrCode.from_json(json)
# print the JSON string representation of the object
print(QrCode.to_json())

# convert the object into a dict
qr_code_dict = qr_code_instance.to_dict()
# create an instance of QrCode from a dict
qr_code_from_dict = QrCode.from_dict(qr_code_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


