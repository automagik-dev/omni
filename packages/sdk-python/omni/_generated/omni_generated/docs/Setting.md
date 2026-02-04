# Setting


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key** | **str** | Setting key | 
**value** | **object** | Setting value (masked if secret) | [optional] 
**category** | **str** | Category | 
**is_secret** | **bool** | Whether value is secret | 
**description** | **str** | Description | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.setting import Setting

# TODO update the JSON string below
json = "{}"
# create an instance of Setting from a JSON string
setting_instance = Setting.from_json(json)
# print the JSON string representation of the object
print(Setting.to_json())

# convert the object into a dict
setting_dict = setting_instance.to_dict()
# create an instance of Setting from a dict
setting_from_dict = Setting.from_dict(setting_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


