# GetInternalHealth200ResponseMemory


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**rss** | **float** |  | 
**heap_total** | **float** |  | 
**heap_used** | **float** |  | 
**external** | **float** |  | 
**array_buffers** | **float** |  | 

## Example

```python
from omni_generated.models.get_internal_health200_response_memory import GetInternalHealth200ResponseMemory

# TODO update the JSON string below
json = "{}"
# create an instance of GetInternalHealth200ResponseMemory from a JSON string
get_internal_health200_response_memory_instance = GetInternalHealth200ResponseMemory.from_json(json)
# print the JSON string representation of the object
print(GetInternalHealth200ResponseMemory.to_json())

# convert the object into a dict
get_internal_health200_response_memory_dict = get_internal_health200_response_memory_instance.to_dict()
# create an instance of GetInternalHealth200ResponseMemory from a dict
get_internal_health200_response_memory_from_dict = GetInternalHealth200ResponseMemory.from_dict(get_internal_health200_response_memory_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


