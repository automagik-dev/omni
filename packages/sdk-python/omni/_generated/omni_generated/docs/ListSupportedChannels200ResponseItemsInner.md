# ListSupportedChannels200ResponseItemsInner


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
from omni_generated.models.list_supported_channels200_response_items_inner import ListSupportedChannels200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListSupportedChannels200ResponseItemsInner from a JSON string
list_supported_channels200_response_items_inner_instance = ListSupportedChannels200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListSupportedChannels200ResponseItemsInner.to_json())

# convert the object into a dict
list_supported_channels200_response_items_inner_dict = list_supported_channels200_response_items_inner_instance.to_dict()
# create an instance of ListSupportedChannels200ResponseItemsInner from a dict
list_supported_channels200_response_items_inner_from_dict = ListSupportedChannels200ResponseItemsInner.from_dict(list_supported_channels200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


