# SupportedChannel


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Channel type ID | 
**name** | **str** | Human-readable channel name | 
**version** | **str** | Plugin version | [optional] 
**description** | **str** | Channel description | [optional] 
**loaded** | **bool** | Whether plugin is loaded | 
**capabilities** | **Dict[str, Optional[object]]** | Plugin capabilities | [optional] 

## Example

```python
from omni_generated.models.supported_channel import SupportedChannel

# TODO update the JSON string below
json = "{}"
# create an instance of SupportedChannel from a JSON string
supported_channel_instance = SupportedChannel.from_json(json)
# print the JSON string representation of the object
print(SupportedChannel.to_json())

# convert the object into a dict
supported_channel_dict = supported_channel_instance.to_dict()
# create an instance of SupportedChannel from a dict
supported_channel_from_dict = SupportedChannel.from_dict(supported_channel_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


