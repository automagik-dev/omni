# SetSettingRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**value** | **object** | Setting value | [optional] 
**reason** | **str** | Reason for change (audit) | [optional] 

## Example

```python
from omni_generated.models.set_setting_request import SetSettingRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SetSettingRequest from a JSON string
set_setting_request_instance = SetSettingRequest.from_json(json)
# print the JSON string representation of the object
print(SetSettingRequest.to_json())

# convert the object into a dict
set_setting_request_dict = set_setting_request_instance.to_dict()
# create an instance of SetSettingRequest from a dict
set_setting_request_from_dict = SetSettingRequest.from_dict(set_setting_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


