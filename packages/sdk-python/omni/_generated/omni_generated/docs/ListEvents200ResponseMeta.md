# ListEvents200ResponseMeta


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**has_more** | **bool** | Whether there are more items | 
**cursor** | **str** | Cursor for next page | 
**total** | **int** |  | [optional] 

## Example

```python
from omni_generated.models.list_events200_response_meta import ListEvents200ResponseMeta

# TODO update the JSON string below
json = "{}"
# create an instance of ListEvents200ResponseMeta from a JSON string
list_events200_response_meta_instance = ListEvents200ResponseMeta.from_json(json)
# print the JSON string representation of the object
print(ListEvents200ResponseMeta.to_json())

# convert the object into a dict
list_events200_response_meta_dict = list_events200_response_meta_instance.to_dict()
# create an instance of ListEvents200ResponseMeta from a dict
list_events200_response_meta_from_dict = ListEvents200ResponseMeta.from_dict(list_events200_response_meta_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


