# SearchEvents200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListEvents200ResponseItemsInner]**](ListEvents200ResponseItemsInner.md) |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 
**summary** | **str** |  | [optional] 
**as_context** | **str** |  | [optional] 

## Example

```python
from omni_generated.models.search_events200_response import SearchEvents200Response

# TODO update the JSON string below
json = "{}"
# create an instance of SearchEvents200Response from a JSON string
search_events200_response_instance = SearchEvents200Response.from_json(json)
# print the JSON string representation of the object
print(SearchEvents200Response.to_json())

# convert the object into a dict
search_events200_response_dict = search_events200_response_instance.to_dict()
# create an instance of SearchEvents200Response from a dict
search_events200_response_from_dict = SearchEvents200Response.from_dict(search_events200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


