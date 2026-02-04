# GetSettingHistory200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[GetSettingHistory200ResponseItemsInner]**](GetSettingHistory200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.get_setting_history200_response import GetSettingHistory200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetSettingHistory200Response from a JSON string
get_setting_history200_response_instance = GetSettingHistory200Response.from_json(json)
# print the JSON string representation of the object
print(GetSettingHistory200Response.to_json())

# convert the object into a dict
get_setting_history200_response_dict = get_setting_history200_response_instance.to_dict()
# create an instance of GetSettingHistory200Response from a dict
get_setting_history200_response_from_dict = GetSettingHistory200Response.from_dict(get_setting_history200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


